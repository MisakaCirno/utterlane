import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'
import i18n from '@renderer/i18n'
import { takeEffectiveRange } from '@shared/project'
import type { EditorActions, SliceCreator } from './types'
import { pushWorkspace } from './save'

/**
 * 播放 slice：单段试听 / 工程连读 / 停止 / 暂停。
 *
 * 切分依据：所有动作都把 playback 字段在 idle / segment / project 之间
 * 推进，副作用只是调 player 服务（不改 segments.json，也不进 undo 栈）。
 * 与 recording 形成对称——同样靠状态机控制 UI，但走另一组事件。
 *
 * 缺失文件守卫：playCurrentSegment 单段命中 missingTakeIds 时直接弹错
 * 提示用户去 Audio Audit 修复；playProject 跳过缺失段，连读不被中断。
 */

/**
 * 把节选区间整理成 player.playFile 的 options。
 *   - startMs === 0 时省略字段，避免对 currentTime 的多余赋值
 *   - endMs === fileDurationMs 时省略字段，避免无意义的 timeupdate 监听
 *
 * 等价于「无 trim 等同于不传 options」，让全段播放走最短路径
 */
function buildPlayOptions(
  range: { startMs: number; endMs: number },
  fileDurationMs: number
): { startMs?: number; endMs?: number } {
  const opts: { startMs?: number; endMs?: number } = {}
  if (range.startMs > 0) opts.startMs = range.startMs
  if (range.endMs < fileDurationMs) opts.endMs = range.endMs
  return opts
}

export const createPlaybackSlice: SliceCreator<
  Pick<EditorActions, 'playCurrentSegment' | 'playProject' | 'stopPlayback' | 'togglePausePlayback'>
> = (set, get) => ({
  /**
   * 播放当前选中 Segment 的当前 Take。
   * 要求：idle + 有 selectedTakeId。
   * 播完 / 被中断后 playback 回 idle（不留 ghost 状态）。
   *
   * 缺失文件守卫：missingTakeIds 由 audit 扫描填充，命中时直接弹错——
   * 否则 player 会调 readTakeFile，main 抛 ENOENT，最终 audio 元素吐
   * 一个不显眼的 console.error，用户看不到反馈
   */
  playCurrentSegment: async () => {
    const state = get()
    if (state.playback !== 'idle') return
    if (!state.selectedSegmentId) return
    const seg = state.segmentsById[state.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    if (!take) return
    if (state.missingTakeIds.has(take.id)) {
      showError(
        i18n.t('errors.play_missing_take_title'),
        i18n.t('errors.play_missing_take_description')
      )
      return
    }

    // 节选区间：take 设了 trim 就只播节选段，否则整段
    const range = takeEffectiveRange(take)
    const playOpts = buildPlayOptions(range, take.durationMs)

    set({ playback: 'segment', paused: false })
    try {
      await player.playFile(take.filePath, playOpts)
    } finally {
      // 只有当 playback 还是我们这一轮设置的 'segment' 时才回落；
      // 如果期间被 playProject 接管，不覆盖它的状态
      if (get().playback === 'segment') set({ playback: 'idle', paused: false })
    }
  },

  /**
   * 连续播放工程里所有「有 selectedTakeId」的 Take。未录制的段自动跳过。
   *
   * 和 Slice D1 的实现不同：这里不再走 player.playSequence，而是把顺序循环
   * 放在 store 里，每段开始前同步 selectedSegmentId。这样 UI 可以跟随
   * 当前播放段高亮 + 自动滚动，也避免 player 层需要理解 segment 语义。
   *
   * === 从游标位置起播 ===
   *
   * 读 timelinePlayheadMs，找到游标落在哪个 take 内，从该段以 startMs
   * 偏移播放，后续段从头播。空白间隔区间（gap 内）也归到「下一段从头
   * 播」——用户在间隔区域点游标后想要的是「下一段从头开始」而非「等
   * 完间隔再播」
   */
  playProject: async () => {
    const state = get()
    if (state.playback !== 'idle') return

    // 收集可播 items + 累计起点：跳过缺失文件的 take。
    // 时间轴用「节选后的有效时长」累计——和 ProjectTimelineView 的 clip
    // 宽度计算保持一致，游标 / 起播 ms 都算的是「实际会播出来的那段时间」
    type PlayableItem = {
      segmentId: string
      filePath: string
      /** 在工程时间轴上的起点（已剔除前序段的 trim 段） */
      effectiveStartMs: number
      /** 本段实际会播出的时长（trimEnd - trimStart） */
      effectiveDurationMs: number
      /** 文件相对的 trim 区间，传给 player.playFile */
      trimStartMs: number
      trimEndMs: number
      fileDurationMs: number
    }
    const items: PlayableItem[] = []
    let cursor = 0
    for (const id of state.order) {
      const seg = state.segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      if (take && !state.missingTakeIds.has(take.id)) {
        const range = takeEffectiveRange(take)
        const effectiveDur = range.endMs - range.startMs
        items.push({
          segmentId: id,
          filePath: take.filePath,
          effectiveStartMs: cursor,
          effectiveDurationMs: effectiveDur,
          trimStartMs: range.startMs,
          trimEndMs: range.endMs,
          fileDurationMs: take.durationMs
        })
        cursor += effectiveDur
      }
      cursor += seg?.gapAfter?.ms ?? 0
    }
    if (items.length === 0) return

    // 找游标对应的起播位置：第一个「结束 ms 大于 playhead」的段。如果
    // playhead 落在 gap 区间，会找到 gap 之后的下一段；如果 playhead
    // 超过总时长，回退到从头播
    const playhead = state.timelinePlayheadMs
    let startIdx = items.findIndex((it) => playhead < it.effectiveStartMs + it.effectiveDurationMs)
    if (startIdx < 0) startIdx = 0
    const offsetWithinFirst = Math.max(0, playhead - items[startIdx].effectiveStartMs)

    set({ playback: 'project', paused: false })
    try {
      for (let i = startIdx; i < items.length; i++) {
        const item = items[i]
        // stopPlayback 会立刻把 playback 切到 idle，循环这里读一次就退出
        if (get().playback !== 'project') break
        set({ selectedSegmentId: item.segmentId })
        pushWorkspace(get())
        // 第一段叠加段内偏移：trimStart + 用户在该段内的起播位置；
        // 后续段从 trimStart 起播。endMs 始终是 trimEnd
        const fileStartMs = (i === startIdx ? offsetWithinFirst : 0) + item.trimStartMs
        await player.playFile(
          item.filePath,
          buildPlayOptions({ startMs: fileStartMs, endMs: item.trimEndMs }, item.fileDurationMs)
        )
      }
      // 自然播完：把游标停在工程末尾，便于用户看到「播到哪了」
      if (get().playback === 'project') {
        set({ timelinePlayheadMs: cursor })
        pushWorkspace(get())
      }
    } finally {
      if (get().playback === 'project') set({ playback: 'idle', paused: false })
    }
  },

  /**
   * 停止播放。直接把 playback 切回 idle（不等 playFile 的 finally），
   * 这样 playProject 循环能立刻看到状态变化并退出，不会多播一段。
   */
  stopPlayback: () => {
    const state = get()
    if (state.playback === 'segment' || state.playback === 'project') {
      player.stop()
      set({ playback: 'idle', paused: false })
    }
  },

  /**
   * 暂停 ↔ 恢复。仅在播放中有意义；idle / recording 时 no-op。
   * 实际的音频暂停 / 恢复交给 player service；本函数只同步状态位。
   */
  togglePausePlayback: () => {
    const state = get()
    if (state.playback !== 'segment' && state.playback !== 'project') return
    if (state.paused) {
      player.resume()
      set({ paused: false })
    } else {
      player.pause()
      set({ paused: true })
    }
  }
})
