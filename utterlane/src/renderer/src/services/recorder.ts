import { encodeWavFromPcm } from './wavEncoder'
// Vite 用 ?url 后缀把 worklet 文件 emit 为静态资源，URL 在 dev / prod 都
// 稳定指向 'self' 同源——避免 CSP script-src 拦截 blob: URL。worklet
// runtime 通过 audioContext.audioWorklet.addModule(url) 在隔离环境里加载它
import workletUrl from './recorder-worklet.js?url'

/**
 * 录音后端：Web Audio (getUserMedia + AudioWorkletNode)。
 *
 * === 为什么是 AudioWorklet 而不是 ScriptProcessorNode ===
 *
 * ScriptProcessorNode 已被 W3C deprecated，本质问题是 onaudioprocess
 * 在主线程被调用——每 ~85ms (4096 samples @ 48kHz) 跑一次。一旦主线程
 * 被 React 重渲染、layout、GC pause 等阻塞超过这个窗口，buffer 就被丢，
 * 录音表现为「中间卡顿」。AudioWorklet 跑在独立 audio rendering thread
 * 与主线程隔离，主线程压力不再影响录音质量。
 *
 * 实现差异：
 *   - 旧：processor.onaudioprocess 同步回调拿 inputBuffer
 *   - 新：worklet process() 通过 port.postMessage 把数据发回主线程；
 *     主线程在 node.port.onmessage 里累积 chunks + 算电平
 *
 * 对外接口（startRecording / stopRecording / cancelRecording /
 * subscribeLevel）完全不变。
 *
 * === 后续切换路标 ===
 *
 * AudioWorklet 仍跑在 Web Audio 内，受 Chromium 调度。如果未来发现：
 *   - 还有可感知的杂音 / 缺帧（极端高负载场景）
 *   - 需要超低延迟监听
 * 再考虑切到 miniaudio utility process。这个模块的对外接口在那次切换里
 * 仍然不变，editorStore 和 UI 不需要改。
 *
 * 本模块提供一个简单的状态机：idle → recording → idle。
 * 同时只允许一个录音会话，开第二次会报错。
 */

type LevelListener = (level: number) => void

type RecordingSession = {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  sink: GainNode
  chunks: Float32Array[]
  sampleRate: number
  channels: 1 | 2
  startedAtMs: number
}

let current: RecordingSession | null = null

/**
 * 电平监听列表挂在模块作用域。
 * 把它和 RecordingSession 解耦是为了解决时序问题：
 *   UI 在 playback 变 'recording' 时就挂载 LevelMeter 组件，
 *   但 startRecording() 的 getUserMedia + worklet load 是异步的，session
 *   还没建立；如果监听挂在 session 上，订阅瞬间 session=null，后面的
 *   电平事件就收不到。解决：listener 常驻，worklet 消息回调每次都向它广播
 */
const levelListeners = new Set<LevelListener>()

/**
 * 计算一块 PCM chunk 的 RMS 级别（0~1）。
 * 用作输入电平指示。为避免每个样本 Math.sqrt，一次性算。
 */
function computeLevel(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) {
    sum += chunk[i] * chunk[i]
  }
  return Math.sqrt(sum / chunk.length)
}

/**
 * Worklet 模块加载是「全 AudioContext 共享」的——同一 context 调一次
 * addModule 即可。但每次 startRecording 都会 new AudioContext（mic 关闭
 * 后旧 context 已 close），所以这个 Promise 缓存只对当次 context 有效，
 * 跨录音会话需要重新 add。我们把 promise 跟 context 绑死——下次新 context
 * 会重新 await
 */
async function ensureWorkletLoaded(context: AudioContext): Promise<void> {
  await context.audioWorklet.addModule(workletUrl)
}

/**
 * 输入设备清单条目。deviceId === '' 时表示该设备属于「默认通信设备」类的
 * 占位，不需要在 UI 上单独列；调用方可以选择过滤
 */
export type AudioInputDevice = { deviceId: string; label: string }

/**
 * 列出所有音频输入设备。需要先获得过麦克风权限才能拿到非空 label——
 * Electron 内一般在第一次 getUserMedia 后就长期持有，正常使用不会出现
 * 空 label。万一空了，我们用 deviceId 前缀做兜底标签
 */
export async function enumerateInputDevices(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || `Device ${d.deviceId.slice(0, 8) || '(unknown)'}`
    }))
}

/**
 * 开始录音。默认采集单声道，最接近人声场景；
 * 如果项目设置是立体声，可以在 options 里传 channels: 2。
 *
 * deviceId 来自 preferences.recording.inputDeviceId。空 / undefined 时
 * 使用系统默认设备。指定 deviceId 但设备已经不在场（拔了 / 改名了）时
 * Chromium 会抛 OverconstrainedError，调用方据此提示用户重新选择
 */
export async function startRecording(options: {
  channels: 1 | 2
  deviceId?: string
}): Promise<void> {
  if (current) {
    throw new Error('已经在录音中，请先停止当前录音')
  }

  const audioConstraints: MediaTrackConstraints = {
    channelCount: options.channels,
    // 关掉浏览器的自动处理以拿到「干净」的原始采集——
    // 后续如果要做降噪 / AGC，应该走我们自己的 DSP 链路而不是依赖浏览器
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
  // exact 约束：设备不在时直接抛错，UI 据此提示用户。如果用 ideal 会
  // 静默回落到默认设备，用户搞不清自己选的麦到底有没有生效
  if (options.deviceId) {
    audioConstraints.deviceId = { exact: options.deviceId }
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })

  const context = new AudioContext()
  // worklet addModule 是 fire-and-forget 的 Promise——首次会触发文件下载
  // + 解析。之后同一 context 调多次没副作用。失败时我们让异常透传到上层，
  // 上层 alert 会提示用户「录音启动失败」
  await ensureWorkletLoaded(context)

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'utterlane-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    // 显式指定 output channel 数 = 输入声道数。AudioWorkletNode 默认
    // 会做 channel up/down mix，与我们「原样捕获」的语义不符
    outputChannelCount: [options.channels],
    channelCount: options.channels,
    channelCountMode: 'explicit'
  })

  const chunks: Float32Array[] = []

  node.port.onmessage = (e: MessageEvent<{ channels: Float32Array[] }>): void => {
    const channels = e.data.channels
    if (!channels || channels.length === 0 || channels[0].length === 0) return

    // 电平用 channel 0 即可——双声道场景没必要分开算
    const level = computeLevel(channels[0])
    for (const cb of levelListeners) cb(level)

    if (options.channels === 1) {
      // 单声道：channels[0] 已经是从 worklet transferred 过来的独立
      // ArrayBuffer，可以直接 push 不用复制
      chunks.push(channels[0])
    } else {
      // 双声道：按 [L0,R0,L1,R1,...] 交错拼进一个数组。
      // 注意 channels.length 可能 < 2（极端情况下 mic 只送了 mono），
      // 这种情况复用左声道当右声道，避免 undefined 访问
      const left = channels[0]
      const right = channels[1] ?? left
      const interleaved = new Float32Array(left.length * 2)
      for (let i = 0; i < left.length; i++) {
        interleaved[i * 2] = left[i]
        interleaved[i * 2 + 1] = right[i]
      }
      chunks.push(interleaved)
    }
  }

  source.connect(node)
  // worklet node 必须连到一个 destination 链才会被 graph schedule。
  // 不想听到麦克风反馈，所以接一个 gain=0 的节点做「静音 sink」——和
  // ScriptProcessor 时代一致
  const sink = context.createGain()
  sink.gain.value = 0
  node.connect(sink)
  sink.connect(context.destination)

  current = {
    stream,
    context,
    source,
    node,
    sink,
    chunks,
    sampleRate: context.sampleRate,
    channels: options.channels,
    startedAtMs: performance.now()
  }
}

/**
 * 订阅实时输入电平。返回 unsubscribe 函数。
 * 可以在录音开始之前提前订阅，不会错过事件。
 */
export function subscribeLevel(cb: LevelListener): () => void {
  levelListeners.add(cb)
  return () => levelListeners.delete(cb)
}

/**
 * 停止录音并把积累的 PCM 编码成 WAV 返回。
 * 调用方拿到 buffer 后自己送给 main 写盘。
 */
export async function stopRecording(): Promise<{
  buffer: ArrayBuffer
  durationMs: number
}> {
  if (!current) throw new Error('当前没有录音')
  const session = current
  current = null

  const durationMs = Math.round(performance.now() - session.startedAtMs)
  await teardown(session)
  const buffer = encodeWavFromPcm(session.chunks, session.sampleRate, session.channels)
  return { buffer, durationMs }
}

/**
 * 取消录音：丢弃累积的 PCM，不编码也不落盘。
 */
export async function cancelRecording(): Promise<void> {
  if (!current) return
  const session = current
  current = null
  await teardown(session)
}

export function isRecording(): boolean {
  return current !== null
}

async function teardown(session: RecordingSession): Promise<void> {
  // 摘消息回调，断开 worklet → sink → destination 链
  session.node.port.onmessage = null
  session.node.disconnect()
  session.sink.disconnect()
  session.source.disconnect()
  // 关闭流与 AudioContext；不关会让麦克风指示灯一直亮
  for (const track of session.stream.getTracks()) track.stop()
  await session.context.close()
  // UI 归零：录音结束后 LevelMeterView 这类常驻订阅者需要一次 0 把条清掉
  for (const cb of levelListeners) cb(0)
}
