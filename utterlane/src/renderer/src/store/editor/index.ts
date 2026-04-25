import { create } from 'zustand'
import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'
import i18n from '@renderer/i18n'
import { INITIAL_DATA, type EditorState } from './types'
import { pushWorkspace } from './save'
import { createLifecycleSlice } from './lifecycle'
import { createWorkspaceSlice } from './workspace'
import { createSegmentsSlice, sanitizeSegmentText } from './segments'
import { createRecordingSlice } from './recording'

/**
 * 编辑器 store 承载「当前打开的工程」的全部内存状态。
 * 工程未打开时 project 为 null，其他字段为空 / 默认，此时 UI 应显示欢迎页。
 *
 * 数据流：
 *   - 打开 / 新建工程：UI 调 window.api.project.{open,new,openPath}，
 *     拿到 ProjectBundle 后调 applyBundle() 灌入 store
 *   - 关闭工程：UI 调 window.api.project.close()，然后 clear()
 *   - 工作区改动（选中 / 滚动 / 缩放）：更新 store 后 send 一份 WorkspaceFile，
 *     main 侧 debounce 保存
 *   - Segments 内容改动（导入 / 编辑文本 / 删除 / 切换当前 Take 等）：
 *     更新 store 后调 scheduleSegmentsSave，200ms debounce 合并连续操作再原子写盘
 *
 * 本 store 不保存偏好类数据（主题、列宽、字体缩放等），那些在 preferencesStore。
 *
 * === 拆分进度 ===
 *
 * 当前文件是「整体搬迁」中转点：编辑路径仍集中在这里，但 types / 落盘
 * 工具已经移到 editor/types.ts、editor/save.ts。后续 commit 会把每组
 * action 抽到独立 slice 文件（lifecycle / workspace / segments /
 * recording / playback），由本文件 spread 组装
 */

// sanitizeSegmentText 已搬到 ./segments.ts，旧 import 路径继续可用
export { sanitizeSegmentText }

// ---------------------------------------------------------------------------
// store 本体
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorState>((set, get) => ({
  ...INITIAL_DATA,

  ...createLifecycleSlice(set, get),
  ...createWorkspaceSlice(set, get),

  ...createSegmentsSlice(set, get),

  ...createRecordingSlice(set, get),

  // -------- 播放 --------

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
}))

