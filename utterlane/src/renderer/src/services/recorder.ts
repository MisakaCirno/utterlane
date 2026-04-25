import { encodeWavFromPcm } from './wavEncoder'

/**
 * 第一版录音后端：Web Audio（getUserMedia + ScriptProcessor）。
 *
 * 为什么选 Web Audio 而不是文档里规划的 miniaudio utility process：
 *   - miniaudio 需要 Node-API addon，依赖 C++ 编译工具链与平台预构建，
 *     设置成本高；Slice D1 先把 IPC 契约和 Take 生成链路跑通
 *   - 后续替换成 miniaudio 后端时，这个模块的对外接口（start / stop / cancel）
 *     不变，editorStore 和 UI 不需要改
 *
 * 为什么用 ScriptProcessorNode 而不是 AudioWorkletNode：
 *   - ScriptProcessorNode 已经被标记 deprecated，但在 Electron 里仍然可用
 *   - AudioWorklet 需要 worklet 文件的独立打包，为 Vite + Electron 配
 *     一套 worklet 路径不划算；miniaudio 方案会直接越过 Web Audio，
 *     AudioWorklet 的迁移就没意义了
 *
 * === 后端切换路标 ===
 *
 * ScriptProcessorNode 的两条已知缺陷：
 *   1. 跑在主线程，重 React 渲染时可能丢音频帧
 *   2. bufferSize 4096 在 48kHz 下 ~85ms 延迟，电平表能感知到滞后
 *
 * 当前都未到「让用户感知到」的程度，所以保持 ScriptProcessor。如果发现：
 *   - 明显的录音杂音 / 缺帧（issue 报告）
 *   - 电平表对人声反应明显延后
 *   - Chromium 升级移除 ScriptProcessor 兼容
 * 任一条满足，就启动 miniaudio utility process 切换；不要回头切到
 * AudioWorklet——那是中间方案，迁移 worklet 打包路径的成本和直接上 miniaudio
 * 接近，但获得的稳定性提升不如后者。
 *
 * 本模块提供一个简单的状态机：idle → recording → idle。
 * 同时只允许一个录音会话，开第二次会报错。
 */

type LevelListener = (level: number) => void

type RecordingSession = {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
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
 *   但 startRecording() 的 getUserMedia 是异步的，session 还没建立；
 *   如果监听挂在 session 上，订阅瞬间 session=null，后面的电平事件就收不到。
 * 解决：listener 常驻，recorder.onaudioprocess 每次都向它广播。
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
  const source = context.createMediaStreamSource(stream)
  // bufferSize 4096 在多数设备上延迟 <100ms，落盘后不会感知到抖动
  const processor = context.createScriptProcessor(4096, options.channels, options.channels)

  const chunks: Float32Array[] = []

  processor.onaudioprocess = (e) => {
    // 先算电平（用原始 channel 0 即可，双声道也没必要分开算平均电平）
    const level = computeLevel(e.inputBuffer.getChannelData(0))
    for (const cb of levelListeners) cb(level)

    if (options.channels === 1) {
      // 单声道：直接拷贝 channel 0
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    } else {
      // 双声道：按 [L0,R0,L1,R1,...] 交错拼进一个数组
      const left = e.inputBuffer.getChannelData(0)
      const right = e.inputBuffer.getChannelData(1)
      const interleaved = new Float32Array(left.length * 2)
      for (let i = 0; i < left.length; i++) {
        interleaved[i * 2] = left[i]
        interleaved[i * 2 + 1] = right[i]
      }
      chunks.push(interleaved)
    }
  }

  source.connect(processor)
  // ScriptProcessor 必须连到 destination 才会触发 onaudioprocess 事件——
  // 但我们不想听到麦克风反馈，所以接一个 gain=0 的节点做「静音 sink」
  const sink = context.createGain()
  sink.gain.value = 0
  processor.connect(sink)
  sink.connect(context.destination)

  current = {
    stream,
    context,
    source,
    processor,
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
  session.processor.disconnect()
  session.source.disconnect()
  session.processor.onaudioprocess = null
  // 关闭流与 AudioContext；不关会让麦克风指示灯一直亮
  for (const track of session.stream.getTracks()) track.stop()
  await session.context.close()
  // UI 归零：录音结束后 LevelMeterView 这类常驻订阅者需要一次 0 把条清掉
  for (const cb of levelListeners) cb(0)
}
