/**
 * 录音回放服务。
 *
 * 单个 Take 播放：读文件 → Blob → HTMLAudioElement.play()。
 * 项目连读：按顺序依次播放，前一段的 'ended' 事件触发下一段。
 *
 * 为什么不用 Web Audio 的 AudioBufferSourceNode：
 *   - HTMLAudioElement 自带解码 + 时间轴 + 事件，拖动 / 暂停 / 倍速都是现成的
 *   - 当前 UI 只需要「播 / 停」两态，HTMLAudio 足够
 *   - 将来要可视化波形时再切 Web Audio，接口层面对上保持不变
 *
 * 电平监测：每次 playFile 会在 HTMLAudioElement 外包一个 AudioContext + AnalyserNode，
 * 用 RAF 循环采样 RMS，推给 subscribePlayerLevel 的订阅者。
 * 播放结束 / 停止时发一次 0 值让 UI 平滑归零。
 *
 * 同一时刻只允许一个播放会话；新的 play 请求会先停掉旧的。
 */

import { devLog } from '@renderer/lib/devLog'

type LevelListener = (level: number) => void

/**
 * 位置事件：告诉订阅者当前正在播哪个文件 + 播到了多少毫秒。
 * playingPath === null 表示当前无活跃播放（刚被 stop / 天然结束）。
 */
type PositionListener = (playingPath: string | null, positionMs: number) => void

let currentAudio: HTMLAudioElement | null = null
/**
 * 全局播放倍速。新创建的 audio 会读取此值；setPlaybackRate 也会立刻
 * 同步到正在播的 audio。范围由调用方（editor store）clamp，本服务
 * 信任它已经合规
 */
let currentRate = 1

export function setPlaybackRate(rate: number): void {
  currentRate = rate
  if (currentAudio) currentAudio.playbackRate = rate
}
let currentObjectUrl: string | null = null
let currentAnalyser: AnalyserNode | null = null
let currentSource: MediaElementAudioSourceNode | null = null
let levelRafId: number | null = null

/**
 * 共享 AudioContext。
 *
 * 浏览器对单页面内 AudioContext 数量有上限（Chrome ~6），原实现每次
 * playFile 都 new 一个并在结束时 close()——连读 100 段就是 100 次创建/
 * 销毁，触发警告甚至 throw。改为模块级单例，懒初始化（first user gesture
 * 后再创建，避免 autoplay policy 阻塞），整个 app 生命周期内只用一个。
 *
 * 副作用：每段播放都会用 createMediaElementSource(audio) 把 HTMLAudio 接
 * 进同一份 graph。规范要求同一 audio 元素只能 createMediaElementSource
 * 一次——但我们每段都 new Audio()，所以不冲突。
 */
let sharedContext: AudioContext | null = null
function getContext(): AudioContext {
  if (!sharedContext) {
    sharedContext = new AudioContext()
  }
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch((err) => {
      devLog('[player] AudioContext resume failed:', err)
    })
  }
  return sharedContext
}

/**
 * 单调递增的 playFile 调用 ID。每次 playFile 进入时 ++ 拿一个新值,await
 * loadBlobUrl 之后用这个值跟 activePlayFileId 比对——若期间又有新的
 * playFile 调用(比如用户连点播放键),自己的 ID 已不再是最新,放弃创建
 * audio,避免「旧调用的 audio 和新调用的 audio 同时活着」。
 *
 * 旧实现是布尔 sequenceAborted:每次 playFile 入口先 stop()(置 true)再
 * 重置为 false。两次并发调用会互相把对方的 abort 标志洗掉,起不到防御
 * 作用——这是「重复点击导致多段音频同时播」的根因
 */
let activePlayFileId = 0

/**
 * 订阅列表挂在模块作用域——UI 组件常驻，需要跨多个 play 会话保持订阅。
 */
const levelListeners = new Set<LevelListener>()
const positionListeners = new Set<PositionListener>()

async function loadBlobUrl(relativePath: string): Promise<string> {
  const buffer = await window.api.project.readTakeFile(relativePath)
  // 诊断：buffer 长度是否符合预期。3 秒 48kHz mono 16-bit ≈ 288KB；
  // 如果显示几百字节甚至 0，说明 IPC / 文件读取有问题
  devLog(`[player] readTakeFile ${relativePath} → ${buffer.byteLength} bytes`)
  const blob = new Blob([buffer], { type: 'audio/wav' })
  return URL.createObjectURL(blob)
}

function emitLevel(level: number): void {
  for (const cb of levelListeners) cb(level)
}

function emitPosition(path: string | null, positionMs: number): void {
  for (const cb of positionListeners) cb(path, positionMs)
}

/**
 * 给 audio 元素包上 Web Audio 分析链：
 *   HTMLAudio → MediaElementSource → AnalyserNode → destination
 * analyser 挂在 destination 上保证声音能听到；
 * RAF 循环同时广播 level (RMS) 和 position (currentTime)。
 *
 * 合成到一个 RAF 循环里，避免开两个 rAF 互相竞争 + 浪费唤醒。
 */
function startAnalysis(audio: HTMLAudioElement, relativePath: string): void {
  const ctx = getContext()
  const source = ctx.createMediaElementSource(audio)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  analyser.connect(ctx.destination)
  currentSource = source
  currentAnalyser = analyser

  const buf = new Float32Array(analyser.fftSize)
  // currentTime 在 HTMLMediaElement 内不是每帧都更新——Chromium 实际以
  // ~30Hz 或与硬件 callback 同步的粗粒度推进。RAF 60Hz 读会得到许多重复
  // 值再突然跳一段，视觉就是「停一下、跳一段、停一下、跳一段」。
  //
  // 解法：在 currentTime 不变的帧用 wall-clock 外推「这一帧应该到哪里
  // 了」，让游标平滑前进。currentTime 真正更新时把累积漂移清零，
  // 不会偏离实际播放位置
  let lastAudioMs = audio.currentTime * 1000
  let lastWallMs = performance.now()
  const MAX_DRIFT_MS = 50

  const tick = (): void => {
    if (!currentAnalyser) return
    currentAnalyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    emitLevel(Math.sqrt(sum / buf.length))

    const audioMs = audio.currentTime * 1000
    const wallMs = performance.now()
    if (audioMs !== lastAudioMs) {
      lastAudioMs = audioMs
      lastWallMs = wallMs
    }
    // audio.paused 时不外推（暂停期间 wall-clock 仍在走，但音频没动）。
    // MAX_DRIFT_MS 上限：万一 currentTime 连续多帧不更新（比如缓冲 / 设备
    // 切换），不让游标无限制跑到前面去
    const drift = audio.paused ? 0 : Math.min(MAX_DRIFT_MS, wallMs - lastWallMs)
    emitPosition(relativePath, lastAudioMs + drift)

    levelRafId = requestAnimationFrame(tick)
  }
  levelRafId = requestAnimationFrame(tick)
}

function stopAnalysis(): void {
  if (levelRafId !== null) {
    cancelAnimationFrame(levelRafId)
    levelRafId = null
  }
  // 断开 source → analyser → destination：context 不关，留给下次 playFile
  // 复用。analyser 也直接置空——下一段会创建新的 analyser 接到同一 ctx 上。
  // currentSource 随 audio 元素一起被 GC（HTMLMediaElement 销毁后
  // MediaElementSource 自动失效）
  if (currentAnalyser) {
    try {
      currentAnalyser.disconnect()
    } catch {
      /* 已断开 */
    }
    currentAnalyser = null
  }
  if (currentSource) {
    try {
      currentSource.disconnect()
    } catch {
      /* 已断开 */
    }
    currentSource = null
  }
  // UI 归零 + 通知「没有活跃播放」
  emitLevel(0)
  emitPosition(null, 0)
}

function teardown(): void {
  stopAnalysis()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl)
    currentObjectUrl = null
  }
}

/**
 * 停止任何正在进行的播放 / 序列。
 * 若当前正在 playFile 的 Promise 中,杀掉 audio 元素后 'error' 事件会让
 * 它在下一个事件循环 resolve。activePlayFileId 同时 ++,让任何还在 await
 * loadBlobUrl 的 playFile 在恢复时拿不到匹配的 ID,放弃创建新 audio
 */
export function stop(): void {
  activePlayFileId++
  teardown()
}

/**
 * playFile 的可选区间。两个字段都是相对文件起点的毫秒数。
 *   - startMs：从该位置起播。loadedmetadata 触发后通过 audio.currentTime
 *     设置；之前设无效（duration 未知）
 *   - endMs：到该位置自动停止。timeupdate 事件每 ~250ms 触发一次，所以
 *     真正停下的位置可能晚 0~250ms——voice 场景这点漂移不可闻
 *
 * 任一字段未提供时，对应端走默认（startMs=0 / 自然播完）。两端都给即可
 * 实现 Take 节选播放
 */
export type PlayFileOptions = {
  startMs?: number
  endMs?: number
}

/**
 * 播放一个 Take 文件。Promise 在自然播完 / 被 stop / 出错时 resolve。
 * 不区分「是否被打断」——调用方通过 stop() 之后的状态自己感知。
 */
export async function playFile(relativePath: string, options: PlayFileOptions = {}): Promise<void> {
  const { startMs, endMs } = options
  devLog(`[player] playFile START ${relativePath} startMs=${startMs ?? 0} endMs=${endMs ?? 'eof'}`)
  stop()
  // 拿一个本次调用专属的 ID。stop() 已经把 activePlayFileId ++ 一次了,
  // 这里再 ++ 让本调用的 myId 不会跟 stop() 的「废弃信号」重合
  const myId = ++activePlayFileId

  const url = await loadBlobUrl(relativePath)
  // 窄口竞态守卫:在 IPC 读文件期间又有新的 playFile 被调用,activePlayFileId
  // 已经被推到更新值;本次调用的 myId 已过时,放弃创建 audio
  if (activePlayFileId !== myId) {
    URL.revokeObjectURL(url)
    devLog(
      `[player] aborted before play() ${relativePath} (id ${myId} → current ${activePlayFileId})`
    )
    return
  }
  const audio = new Audio(url)
  // 应用当前全局倍速。setPlaybackRate 后续调用会同步到 currentAudio；
  // 这里在 currentAudio 赋值之前先写一次，保证 metadata 加载完后 audio
  // 能用正确速度起播
  audio.playbackRate = currentRate
  currentAudio = audio
  currentObjectUrl = url

  // 起分析必须在调用 audio.play() 之前：某些浏览器要求 MediaElementSource
  // 创建于首次 play 之前（不然会警告 CORS / already-connected 之类）
  startAnalysis(audio, relativePath)

  return new Promise<void>((resolve) => {
    // resolved 标记 + 显式 removeEventListener 双重保险：
    // teardown 内部会把 audio.src 清空（释放资源 / 帮 GC），那一步会再
    // 触发一次 audio 的 'error' 事件（"Empty src attribute"）。如果不
    // 摘掉监听器，会跑出一条看着像出错但其实是清理动作的日志
    let resolved = false

    const onLoadedMetadata = (): void => {
      devLog(`[player] loadedmetadata ${relativePath} duration=${audio.duration}s`)
      // duration 仅在 loadedmetadata 后稳定，此时再设 currentTime 是安全的。
      // 把 startMs clamp 到 [0, duration]：既防御越界，也兼容 trim 后段
      // 时长被改小但旧 startMs 没同步的极端情况
      if (startMs !== undefined && startMs > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(Math.max(0, startMs / 1000), audio.duration)
      }
    }
    const onTimeUpdate = (): void => {
      // endMs 早停：currentTime 单位秒，转回 ms 与 endMs 比对
      if (endMs !== undefined && audio.currentTime * 1000 >= endMs) {
        done('end-ms-reached')
      }
    }
    const onEnded = (): void => done('ended')
    const onError = (): void => {
      const err = audio.error
      // 用 console.error 而不是 devError——audio 真正出错（解码失败 /
      // CSP 拦截 / 文件损坏等）需要在生产环境也留痕，方便用户报 bug
      // 时能附上日志（electron-log 会把 console.error 转发到 main 的
      // 日志文件）
      console.error(
        `[player] audio element error for ${relativePath}: code=${err?.code} message=${err?.message ?? '(none)'}`
      )
      done('error-event')
    }
    const done = (reason: string): void => {
      if (resolved) return
      resolved = true
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      devLog(
        `[player] done(${reason}) ${relativePath} currentTime=${audio.currentTime}s duration=${audio.duration}s`
      )
      // 只有当前这个 audio 还是活跃会话时才清理——
      // 避免「新的 playFile 已经启动但旧 audio 的 ended 晚到」引发的误清理
      if (currentAudio === audio) {
        if (!audio.paused) audio.pause()
        teardown()
      }
      resolve()
    }
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    if (endMs !== undefined) audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    void audio
      .play()
      .then(() => devLog(`[player] play() resolved ${relativePath}`))
      .catch((err) => {
        // play() 真被拒（NotAllowedError / NotSupportedError 等）也要在
        // 生产留痕——同 audio error 的理由
        console.error(`[player] play() rejected for ${relativePath}:`, err)
        done('play-reject')
      })
  })
}

export function isPlaying(): boolean {
  return currentAudio !== null
}

/**
 * 暂停当前会话。调用后 audio 保持现位置；resume() 从原处继续。
 * 无会话或已经 paused 则 no-op。
 */
export function pause(): void {
  currentAudio?.pause()
}

/**
 * 从暂停处继续。无会话则 no-op。
 */
export function resume(): void {
  void currentAudio?.play().catch(() => {
    // 极端情况下 HTMLAudio 可能拒绝 resume（切换设备 / Audio tab 休眠等）
    // 这里吞掉错误；上层 playback 状态会在 ended / error 事件触发时修正
  })
}

/**
 * 订阅播放期间的实时电平（RMS）。返回 unsubscribe。
 * 在 idle 期间没有事件；会话结束时会收到一次 level=0 用于 UI 归零。
 */
export function subscribeLevel(cb: LevelListener): () => void {
  levelListeners.add(cb)
  return () => levelListeners.delete(cb)
}

/**
 * 订阅播放位置。回调参数 (playingPath, positionMs)：
 *   - playingPath !== null：正在播这个文件，positionMs 是当前播放毫秒数
 *   - playingPath === null：当前没有活跃播放（停止 / 结束）
 *
 * 订阅者通常把 playingPath 和自己关心的文件比对，只在匹配时显示游标。
 */
export function subscribePosition(cb: PositionListener): () => void {
  positionListeners.add(cb)
  return () => positionListeners.delete(cb)
}
