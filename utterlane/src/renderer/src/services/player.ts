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
 * 同一时刻只允许一个播放会话；新的 play 请求会先停掉旧的。
 */

let currentAudio: HTMLAudioElement | null = null
let currentObjectUrl: string | null = null

/** 连读播放时被 stop 打断的标记。下一次进 loop 循环体时用它跳出。 */
let sequenceAborted = false

async function loadBlobUrl(relativePath: string): Promise<string> {
  const buffer = await window.api.project.readTakeFile(relativePath)
  const blob = new Blob([buffer], { type: 'audio/wav' })
  return URL.createObjectURL(blob)
}

function teardown(): void {
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
 * 若当前正在 playFile 的 Promise 中，它会在下一个事件循环内 resolve；
 * 若当前在 playSequence 的循环间隙，sequenceAborted 标记会让它跳出。
 */
export function stop(): void {
  sequenceAborted = true
  teardown()
}

/**
 * 播放一个 Take 文件。Promise 在自然播完 / 被 stop / 出错时 resolve。
 * 不区分「是否被打断」——调用方通过 stop() 之后的状态自己感知。
 */
export async function playFile(relativePath: string): Promise<void> {
  stop()
  sequenceAborted = false

  const url = await loadBlobUrl(relativePath)
  // 窄口竞态守卫：用户在 IPC 读文件期间又点了 stop，这里直接丢弃本次播放
  if (sequenceAborted) {
    URL.revokeObjectURL(url)
    return
  }
  const audio = new Audio(url)
  currentAudio = audio
  currentObjectUrl = url

  return new Promise<void>((resolve) => {
    const done = (): void => {
      // 只有当前这个 audio 还是活跃会话时才清理——
      // 避免「新的 playFile 已经启动但旧 audio 的 ended 晚到」引发的误清理
      if (currentAudio === audio) teardown()
      resolve()
    }
    audio.addEventListener('ended', done, { once: true })
    audio.addEventListener('error', done, { once: true })
    void audio.play().catch(done)
  })
}

/**
 * 按序播放一组文件。stop() 会从当前段开始中止；未播到的段被跳过。
 */
export async function playSequence(relativePaths: string[]): Promise<void> {
  stop()
  sequenceAborted = false
  for (const path of relativePaths) {
    if (sequenceAborted) return
    await playFile(path)
    // playFile 内部会清掉 sequenceAborted=false？不会；只有 stop 会设 true。
    // 这里用它做循环守卫继续下一段。
  }
}

export function isPlaying(): boolean {
  return currentAudio !== null
}
