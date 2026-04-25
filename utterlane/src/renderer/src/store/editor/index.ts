import { create } from 'zustand'
import * as recorder from '@renderer/services/recorder'
import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'
import { alert as alertDialog } from '@renderer/store/confirmStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import i18n from '@renderer/i18n'
import { INITIAL_DATA, type EditorState } from './types'
import { markDirty, pushWorkspace, scheduleSegmentsSave } from './save'
import { createLifecycleSlice } from './lifecycle'
import { createWorkspaceSlice } from './workspace'
import { createSegmentsSlice, sanitizeSegmentText } from './segments'

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

// ---------------------------------------------------------------------------
// 文案导入：按行切分成 Segment。
//
// 规则：
//   - 去除行首尾空白
//   - 单个空行视为段落边界：下一个非空行的 Segment 标记 paragraphStart = true
//   - 连续多个空行折叠成一次段落边界（不会产生空段）
//   - 第一段第一句默认 paragraphStart = true
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 录音流程辅助：可选 countdown 阶段 + 真正开录。
//
// 写在模块作用域而不是塞进 action 闭包，是因为这套流程被两个 action
// （新录 / 重录）共用，逻辑唯一区别只是 takeId 来源
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// sanitizeSegmentText 已搬到 ./segments.ts，旧 import 路径继续可用
export { sanitizeSegmentText }

async function beginRecordingFlow(
  segmentId: string,
  takeId: string,
  channels: 1 | 2
): Promise<void> {
  // 从 preferences 取倒计时秒数与输入设备。两者都可能不存在——倒计时回落 0
  // （= 关闭），deviceId 回落 undefined（= 系统默认设备）
  const recordingPrefs = usePreferencesStore.getState().prefs.recording
  const countdownSeconds = recordingPrefs?.countdownSeconds ?? 0
  const deviceId = recordingPrefs?.inputDeviceId

  if (countdownSeconds > 0) {
    useEditorStore.setState({
      playback: 'countdown',
      countdownRemaining: countdownSeconds,
      recordingSegmentId: segmentId,
      recordingTakeId: takeId
    })

    for (let n = countdownSeconds; n > 0; n--) {
      useEditorStore.setState({ countdownRemaining: n })
      await sleep(1000)
      // sleep 期间用户可能按 Esc 触发了 cancelCountdown 把 playback 切到 idle，
      // 检测到就退出
      if (useEditorStore.getState().playback !== 'countdown') return
    }
  }

  // 进入正式录音
  useEditorStore.setState({
    playback: 'recording',
    countdownRemaining: 0,
    recordingSegmentId: segmentId,
    recordingTakeId: takeId
  })

  try {
    await recorder.startRecording({ channels, deviceId })
  } catch (err) {
    useEditorStore.setState({
      playback: 'idle',
      recordingSegmentId: null,
      recordingTakeId: null
    })
    // OverconstrainedError 通常意味着用户偏好里存的 deviceId 已经不在场
    // （设备被拔了 / 改名了 / 驱动重置）。给一条更明确的提示让用户去重选
    const e = err as Error
    const isDeviceMissing = e.name === 'OverconstrainedError' || e.name === 'NotFoundError'
    showError(
      i18n.t('errors.recording_start_title'),
      isDeviceMissing ? i18n.t('errors.recording_device_missing') : e.message
    )
  }
}

// ---------------------------------------------------------------------------
// store 本体
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorState>((set, get) => ({
  ...INITIAL_DATA,

  ...createLifecycleSlice(set, get),
  ...createWorkspaceSlice(set, get),

  ...createSegmentsSlice(set, get),

  // -------- 录音 --------

  /**
   * 对当前选中 Segment 新增一个 Take。
   * 要求：有活动工程 + 选中了某个 Segment + 当前不在录音 / 播放中。
   * 倒计时开启（preferences.recording.countdownSeconds > 0）时先走 N 秒
   * countdown 阶段，期间用户按 Esc 或点击 overlay 都会取消并回到 idle。
   */
  startRecordingForSelected: async () => {
    const state = get()
    if (!state.project || !state.selectedSegmentId) return
    if (state.playback !== 'idle') return
    await beginRecordingFlow(
      state.selectedSegmentId,
      crypto.randomUUID(),
      state.project.audio.channels
    )
  },

  /**
   * 重录：沿用当前选中 Take 的 ID，录完后 writeTake 会原子覆盖同名文件，
   * 新的 durationMs 会替换原记录，selectedTakeId 不变。
   */
  startRerecordingSelected: async () => {
    const state = get()
    if (!state.project || !state.selectedSegmentId) return
    if (state.playback !== 'idle') return
    const seg = state.segmentsById[state.selectedSegmentId]
    if (!seg?.selectedTakeId) return
    // 复用同 takeId → writeTake 会覆盖同名文件
    await beginRecordingFlow(
      state.selectedSegmentId,
      seg.selectedTakeId,
      state.project.audio.channels
    )
  },

  cancelCountdown: () => {
    const state = get()
    if (state.playback !== 'countdown') return
    // 直接回 idle，等待 beginRecordingFlow 内部的循环检测到状态变化后退出。
    // 不需要主动 reject 任何 Promise——sleep 自然走完，sleep 后第一句
    // get().playback 检查就 return 了
    set({
      playback: 'idle',
      countdownRemaining: 0,
      recordingSegmentId: null,
      recordingTakeId: null
    })
  },

  stopRecordingAndSave: async () => {
    const state = get()
    if (state.playback !== 'recording') return
    const segmentId = state.recordingSegmentId
    const takeId = state.recordingTakeId
    if (!segmentId || !takeId) return

    let result: { buffer: ArrayBuffer; durationMs: number }
    try {
      result = await recorder.stopRecording()
    } catch (err) {
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
      // 录音失败用强模态 alert：toast 一闪就过用户可能看不到，下次回放才发现
      // 录音没保存。alert 必须用户点 OK 才消失，确保 acknowledge
      void alertDialog({
        title: i18n.t('errors.recording_stop_title'),
        description: i18n.t('errors.recording_stop_description', {
          message: (err as Error).message
        }),
        tone: 'danger'
      })
      return
    }

    const writeRes = await window.api.recording.writeTake(segmentId, takeId, result.buffer)
    if (!writeRes.ok) {
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
      void alertDialog({
        title: i18n.t('errors.recording_persist_title'),
        description: i18n.t('errors.recording_persist_description', {
          message: writeRes.message
        }),
        tone: 'danger'
      })
      return
    }

    // 写盘成功后更新 segments：
    //   - 如果 takeId 在 takes 里已经存在 → 重录：原地替换 durationMs（文件已被覆盖），selectedTakeId 不变
    //   - 否则 → 新录：追加 Take，selectedTakeId 指向它
    set((s) => {
      const seg = s.segmentsById[segmentId]
      if (!seg) return s
      const existingIdx = seg.takes.findIndex((t) => t.id === takeId)
      if (existingIdx >= 0) {
        const nextTakes = seg.takes.slice()
        nextTakes[existingIdx] = {
          ...nextTakes[existingIdx],
          filePath: writeRes.filePath,
          durationMs: result.durationMs
        }
        return {
          segmentsById: { ...s.segmentsById, [segmentId]: { ...seg, takes: nextTakes } },
          playback: 'idle',
          recordingSegmentId: null,
          recordingTakeId: null,
          ...markDirty()
        }
      }
      return {
        segmentsById: {
          ...s.segmentsById,
          [segmentId]: {
            ...seg,
            takes: [
              ...seg.takes,
              { id: takeId, filePath: writeRes.filePath, durationMs: result.durationMs }
            ],
            selectedTakeId: takeId
          }
        },
        playback: 'idle',
        recordingSegmentId: null,
        recordingTakeId: null,
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  cancelRecording: async () => {
    const state = get()
    if (state.playback !== 'recording') return
    await recorder.cancelRecording().catch(() => {})
    set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
  },

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

// recording 用的内部 helpers 后续 18.5 commit 搬到 ./recording.ts；此处保留 export 兼容外部 import
export { sleep, beginRecordingFlow }
