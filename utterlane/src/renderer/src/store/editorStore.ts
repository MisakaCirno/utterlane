import { create } from 'zustand'
import {
  SEGMENTS_SCHEMA_VERSION,
  type ProjectBundle,
  type SegmentsFile,
  type WorkspaceFile
} from '@shared/project'
import type { PlaybackMode, Project, Segment } from '@renderer/types/project'
import * as recorder from '@renderer/services/recorder'
import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'

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
 */
type EditorState = {
  /** 工程目录的绝对路径；仅在内存和 IPC 中流通，不会写入任何工程文件 */
  projectPath: string | null
  /** 当前打开的工程元信息；null 表示没有活动工程 */
  project: Project | null
  order: string[]
  segmentsById: Record<string, Segment>

  selectedSegmentId: string | undefined
  lastPreviewedTakeId: string | undefined
  scriptListScrollTop: number
  timelineScrollLeft: number
  timelineZoom: number

  playback: PlaybackMode
  /** 磁盘上的 segments.json 是否和内存一致。UI 用来显示「已保存/未保存」提示 */
  saved: boolean

  /**
   * 当前录音会话的目标 Segment / Take ID。
   * 录音期间即使用户切到别的 Segment，停止录音产生的 Take 仍然归属这个 Segment，
   * 避免「录到一半点错」产生的归属错乱。
   */
  recordingSegmentId: string | null
  recordingTakeId: string | null

  // 生命周期
  applyBundle: (bundle: ProjectBundle) => void
  clear: () => void

  // 工作区（UI 上下文）
  selectSegment: (id: string | undefined) => void
  setPlayback: (mode: PlaybackMode) => void
  setScriptListScrollTop: (top: number) => void
  setTimelineScroll: (left: number, zoom?: number) => void

  // Segment / Take 编辑
  importScript: (rawText: string) => void
  editSegmentText: (id: string, text: string) => void
  deleteSegment: (id: string) => void
  reorderSegments: (nextOrder: string[]) => void
  setSelectedTake: (segmentId: string, takeId: string) => void
  deleteTake: (segmentId: string, takeId: string) => void

  // 录音
  startRecordingForSelected: () => Promise<void>
  /** 重录：覆盖当前选中 Take 的音频文件，selectedTakeId 不变 */
  startRerecordingSelected: () => Promise<void>
  stopRecordingAndSave: () => Promise<void>
  cancelRecording: () => Promise<void>

  // 播放
  playCurrentSegment: () => Promise<void>
  playProject: () => Promise<void>
  stopPlayback: () => void
}

// ---------------------------------------------------------------------------
// workspace 保存：同步快照 + push 给 main（main 做 debounce）
// ---------------------------------------------------------------------------

function snapshotWorkspace(state: EditorState): WorkspaceFile {
  return {
    schemaVersion: 1,
    selectedSegmentId: state.selectedSegmentId,
    lastPreviewedTakeId: state.lastPreviewedTakeId,
    scriptListScrollTop: state.scriptListScrollTop,
    timelineScrollLeft: state.timelineScrollLeft,
    timelineZoom: state.timelineZoom
  }
}

function pushWorkspace(state: EditorState): void {
  if (!state.projectPath) return
  window.api.project.saveWorkspace(snapshotWorkspace(state))
}

// ---------------------------------------------------------------------------
// segments.json 保存：200ms debounce 合并连续 mutate，再发一次 IPC。
// 放在模块作用域而不是 store 内，是为了避免每次 setState 都重建闭包。
// ---------------------------------------------------------------------------

const SEGMENTS_SAVE_DEBOUNCE_MS = 200
let segmentsSaveTimer: ReturnType<typeof setTimeout> | null = null

function snapshotSegments(state: EditorState): SegmentsFile {
  return {
    schemaVersion: SEGMENTS_SCHEMA_VERSION,
    order: state.order,
    segmentsById: state.segmentsById
  }
}

function scheduleSegmentsSave(): void {
  if (segmentsSaveTimer) clearTimeout(segmentsSaveTimer)
  segmentsSaveTimer = setTimeout(() => {
    segmentsSaveTimer = null
    const state = useEditorStore.getState()
    if (!state.projectPath) return
    const snapshot = snapshotSegments(state)
    window.api.project.saveSegments(snapshot).then((result) => {
      if (result.ok) {
        // 保存期间如果又有改动，saved 已经被 markDirty 重置为 false，这里不要覆盖
        if (!segmentsSaveTimer) {
          useEditorStore.setState({ saved: true })
        }
      } else {
        // 工程内容写入失败是严重问题，弹出提示让用户知道
        console.error('[editorStore] saveSegments failed:', result.message)
        showError('保存失败', `segments.json 写入出错：${result.message}`)
      }
    })
  }, SEGMENTS_SAVE_DEBOUNCE_MS)
}

function markDirty(): { saved: false } {
  return { saved: false }
}

// ---------------------------------------------------------------------------
// 文案导入：按行切分成 Segment。
// 规则：去除行首尾空白，忽略空行；Segment id 用 crypto.randomUUID。
// ---------------------------------------------------------------------------

function splitScriptIntoSegments(rawText: string): Segment[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({
      id: crypto.randomUUID(),
      text,
      takes: []
    }))
}

// ---------------------------------------------------------------------------
// store 本体
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorState>((set, get) => ({
  projectPath: null,
  project: null,
  order: [],
  segmentsById: {},

  selectedSegmentId: undefined,
  lastPreviewedTakeId: undefined,
  scriptListScrollTop: 0,
  timelineScrollLeft: 0,
  timelineZoom: 1,

  playback: 'idle',
  saved: true,
  recordingSegmentId: null,
  recordingTakeId: null,

  applyBundle: (bundle) =>
    set({
      projectPath: bundle.path,
      project: bundle.project,
      order: bundle.segments.order,
      segmentsById: bundle.segments.segmentsById,
      selectedSegmentId: bundle.workspace.selectedSegmentId,
      lastPreviewedTakeId: bundle.workspace.lastPreviewedTakeId,
      scriptListScrollTop: bundle.workspace.scriptListScrollTop ?? 0,
      timelineScrollLeft: bundle.workspace.timelineScrollLeft ?? 0,
      timelineZoom: bundle.workspace.timelineZoom ?? 1,
      playback: 'idle',
      saved: true,
      recordingSegmentId: null,
      recordingTakeId: null
    }),

  clear: () => {
    // 切换工程时若 segments 还有 pending 保存，直接丢弃定时器——
    // 此时前一份工程的锁即将释放，保存已经来不及了（close 已经 flush 过 workspace）。
    if (segmentsSaveTimer) {
      clearTimeout(segmentsSaveTimer)
      segmentsSaveTimer = null
    }
    set({
      projectPath: null,
      project: null,
      order: [],
      segmentsById: {},
      selectedSegmentId: undefined,
      lastPreviewedTakeId: undefined,
      scriptListScrollTop: 0,
      timelineScrollLeft: 0,
      timelineZoom: 1,
      playback: 'idle',
      saved: true,
      recordingSegmentId: null,
      recordingTakeId: null
    })
  },

  // -------- workspace --------

  selectSegment: (id) => {
    set({ selectedSegmentId: id })
    pushWorkspace(get())
  },
  setPlayback: (mode) => set({ playback: mode }),
  setScriptListScrollTop: (top) => {
    set({ scriptListScrollTop: top })
    pushWorkspace(get())
  },
  setTimelineScroll: (left, zoom) => {
    set({ timelineScrollLeft: left, ...(zoom !== undefined && { timelineZoom: zoom }) })
    pushWorkspace(get())
  },

  // -------- segments --------

  importScript: (rawText) => {
    const segments = splitScriptIntoSegments(rawText)
    const segmentsById: Record<string, Segment> = {}
    for (const s of segments) segmentsById[s.id] = s
    set({
      order: segments.map((s) => s.id),
      segmentsById,
      selectedSegmentId: segments[0]?.id,
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  editSegmentText: (id, text) => {
    set((state) => {
      const seg = state.segmentsById[id]
      if (!seg || seg.text === text) return state
      return {
        segmentsById: {
          ...state.segmentsById,
          [id]: { ...seg, text }
        },
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  /**
   * 替换式重排：调用方传入整份新的 order 数组。
   * 既服务拖拽（UI 算好新顺序后一次性传入），也方便后续加「批量排序」等功能。
   * 我们只做长度和成员校验，防御 UI bug 把 order 污染掉。
   */
  reorderSegments: (nextOrder) => {
    set((state) => {
      if (nextOrder.length !== state.order.length) return state
      // 成员必须和旧 order 完全一致，仅顺序不同
      const currentSet = new Set(state.order)
      for (const id of nextOrder) {
        if (!currentSet.has(id)) return state
      }
      // 顺序未变则不写盘
      const same = nextOrder.every((id, i) => id === state.order[i])
      if (same) return state
      return { order: nextOrder, ...markDirty() }
    })
    scheduleSegmentsSave()
  },

  deleteSegment: (id) => {
    set((state) => {
      if (!state.segmentsById[id]) return state
      const nextOrder = state.order.filter((oid) => oid !== id)
      const nextById = { ...state.segmentsById }
      delete nextById[id]
      // 选中态跟随：若删除的是当前选中段，自动选相邻段（优先后一个，没有就前一个，都没有就清空）
      let nextSelected = state.selectedSegmentId
      if (nextSelected === id) {
        const removedIdx = state.order.indexOf(id)
        nextSelected = nextOrder[removedIdx] ?? nextOrder[removedIdx - 1]
      }
      return {
        order: nextOrder,
        segmentsById: nextById,
        selectedSegmentId: nextSelected,
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  setSelectedTake: (segmentId, takeId) => {
    set((state) => {
      const seg = state.segmentsById[segmentId]
      if (!seg || seg.selectedTakeId === takeId) return state
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...seg, selectedTakeId: takeId }
        },
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  /**
   * 删除 Take 的行为规则（见 docs/utterlane.md#Take-管理）：
   *   - 允许删除非当前 Take；selectedTakeId 不变
   *   - 允许删除当前 Take；自动修复到相邻 Take（优先后一个，否则前一个），
   *     无剩余时置空
   */
  deleteTake: (segmentId, takeId) => {
    set((state) => {
      const seg = state.segmentsById[segmentId]
      if (!seg) return state
      const removedIdx = seg.takes.findIndex((t) => t.id === takeId)
      if (removedIdx < 0) return state

      const nextTakes = seg.takes.filter((t) => t.id !== takeId)
      let nextSelectedTakeId = seg.selectedTakeId
      if (nextSelectedTakeId === takeId) {
        const neighbor = nextTakes[removedIdx] ?? nextTakes[removedIdx - 1]
        nextSelectedTakeId = neighbor?.id
      }
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: {
            ...seg,
            takes: nextTakes,
            selectedTakeId: nextSelectedTakeId
          }
        },
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  // -------- 录音 --------

  /**
   * 对当前选中 Segment 新增一个 Take。
   * 要求：有活动工程 + 选中了某个 Segment + 当前不在录音 / 播放中。
   * 失败时恢复 playback 为 idle，并用 alert 提示（后续换成 toast）。
   */
  startRecordingForSelected: async () => {
    const state = get()
    if (!state.project || !state.selectedSegmentId) return
    if (state.playback !== 'idle') return

    const segmentId = state.selectedSegmentId
    const takeId = crypto.randomUUID()

    set({ playback: 'recording', recordingSegmentId: segmentId, recordingTakeId: takeId })

    try {
      await recorder.startRecording({ channels: state.project.audio.channels })
    } catch (err) {
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
      showError('无法开始录音', (err as Error).message)
    }
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

    const segmentId = state.selectedSegmentId
    const takeId = seg.selectedTakeId // 复用同 ID → writeTake 覆盖同文件

    set({ playback: 'recording', recordingSegmentId: segmentId, recordingTakeId: takeId })

    try {
      await recorder.startRecording({ channels: state.project.audio.channels })
    } catch (err) {
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
      showError('无法开始录音', (err as Error).message)
    }
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
      showError('停止录音失败', (err as Error).message)
      return
    }

    const writeRes = await window.api.recording.writeTake(segmentId, takeId, result.buffer)
    if (!writeRes.ok) {
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
      showError('录音落盘失败', writeRes.message)
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
   */
  playCurrentSegment: async () => {
    const state = get()
    if (state.playback !== 'idle') return
    if (!state.selectedSegmentId) return
    const seg = state.segmentsById[state.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    if (!take) return

    set({ playback: 'segment' })
    try {
      await player.playFile(take.filePath)
    } finally {
      // 只有当 playback 还是我们这一轮设置的 'segment' 时才回落；
      // 如果期间被 playProject 接管，不覆盖它的状态
      if (get().playback === 'segment') set({ playback: 'idle' })
    }
  },

  /**
   * 连续播放工程里所有「有 selectedTakeId」的 Take。未录制的段自动跳过。
   */
  playProject: async () => {
    const state = get()
    if (state.playback !== 'idle') return
    const files: string[] = []
    for (const id of state.order) {
      const seg = state.segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      if (take) files.push(take.filePath)
    }
    if (files.length === 0) return

    set({ playback: 'project' })
    try {
      await player.playSequence(files)
    } finally {
      if (get().playback === 'project') set({ playback: 'idle' })
    }
  },

  stopPlayback: () => {
    const state = get()
    if (state.playback === 'segment' || state.playback === 'project') {
      player.stop()
      // finally 分支会把 playback 重置为 idle
    }
  }
}))
