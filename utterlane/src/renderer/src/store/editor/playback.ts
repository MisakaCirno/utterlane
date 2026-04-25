import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'
import i18n from '@renderer/i18n'
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

    set({ playback: 'segment', paused: false })
    try {
      await player.playFile(take.filePath)
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
   */
  playProject: async () => {
    const state = get()
    if (state.playback !== 'idle') return
    // 跳过缺失文件的 take：和导出的「跳过未录段」语义一致——连读不应被
    // 一个丢失文件中断，整体仍能播完
    const items: Array<{ segmentId: string; filePath: string }> = []
    for (const id of state.order) {
      const seg = state.segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      if (take && !state.missingTakeIds.has(take.id)) {
        items.push({ segmentId: id, filePath: take.filePath })
      }
    }
    if (items.length === 0) return

    set({ playback: 'project', paused: false })
    try {
      for (const item of items) {
        // stopPlayback 会立刻把 playback 切到 idle，循环这里读一次就退出
        if (get().playback !== 'project') break
        set({ selectedSegmentId: item.segmentId })
        pushWorkspace(get())
        await player.playFile(item.filePath)
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
