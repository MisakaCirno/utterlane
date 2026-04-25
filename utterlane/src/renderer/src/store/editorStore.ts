import { create } from 'zustand'
import {
  SEGMENTS_SCHEMA_VERSION,
  type ProjectBundle,
  type SegmentsFile,
  type WorkspaceFile
} from '@shared/project'
import type { PlaybackMode, Project, Segment, Take } from '@renderer/types/project'
import * as recorder from '@renderer/services/recorder'
import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'
import { useHistoryStore } from '@renderer/store/historyStore'
import i18n from '@renderer/i18n'

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
  /**
   * 是否处于暂停态。仅在 playback === 'segment' | 'project' 时有意义。
   * 独立于 playback 的好处：stop / 切换 Segment 这类操作只需要改一个字段，
   * 不用考虑「idle-paused」这种不存在的组合；UI 层按 (playback, paused) 元组
   * 渲染按钮即可。
   */
  paused: boolean
  /** 磁盘上的 segments.json 是否和内存一致。UI 用来显示「已保存/未保存」提示 */
  saved: boolean

  /**
   * 当前录音会话的目标 Segment / Take ID。
   * 录音期间即使用户切到别的 Segment，停止录音产生的 Take 仍然归属这个 Segment，
   * 避免「录到一半点错」产生的归属错乱。
   */
  recordingSegmentId: string | null
  recordingTakeId: string | null

  /**
   * 已知缺失文件的 Take ID 集合。在 applyBundle 之后由 audio-audit:scan 后台
   * 填充，UI（Inspector / Segment 列表等）据此打缺失徽标。
   *
   * 维护策略：lazy。AudioAuditDialog 打开时会重扫并覆盖；remap 成功后从集合
   * 里删除对应 takeId；其他 mutation 不维护此集合，标记可能短暂偏旧——
   * 用户可以随时打开审计面板触发重扫修正。
   */
  missingTakeIds: ReadonlySet<string>

  // 生命周期
  applyBundle: (bundle: ProjectBundle) => void
  clear: () => void

  /**
   * 给 historyStore 用的专用通路：以 patch 函数形式替换若干字段，
   * 统一处理 saved 标记、segments 落盘调度与 workspace 推送。
   *
   * patch 返回 null 表示放弃本次 undo / redo（比如命令引用的 Segment 已经不存在）。
   * 不想让 historyStore 各分支各自 new 一份 IPC 调用，所以集中在这里转发。
   */
  applyHistoryPatch: (patch: (s: EditorState) => Partial<EditorState> | null) => void

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

  // 音频文件审计
  /** 用 audit 扫描结果覆盖 missingTakeIds，集合会被 UI 用作缺失徽标的依据 */
  setMissingTakeIds: (takeIds: Iterable<string>) => void
  /**
   * 缺失 Take 修复成功后调用：把 Take.durationMs 同步成新文件的时长，
   * 同时把 takeId 从 missingTakeIds 移除。filePath 不动——它由 takeId 决定，
   * remap 把文件复制到了同一相对路径
   */
  applyRemapResult: (segmentId: string, takeId: string, durationMs: number) => void
  /**
   * 把孤儿 WAV 转为 Take 的反向操作：往指定 Segment 追加新 Take。
   * 不进 undo 栈（修复性操作）
   */
  appendTakeFromOrphan: (segmentId: string, take: Take) => void

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
  togglePausePlayback: () => void
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
        showError(
          i18n.t('errors.save_segments_title'),
          i18n.t('errors.save_segments_description', { message: result.message })
        )
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
  paused: false,
  saved: true,
  recordingSegmentId: null,
  recordingTakeId: null,
  missingTakeIds: new Set<string>(),

  applyBundle: (bundle) => {
    // 切换工程必须清空 undo / redo 栈，否则新工程头一次按 Ctrl+Z 会把上个工程
    // 遗留的 deleteSegment 命令应用到当前 segmentsById 上，产生幽灵段
    useHistoryStore.getState().clear()
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
      paused: false,
      saved: true,
      recordingSegmentId: null,
      recordingTakeId: null,
      missingTakeIds: new Set<string>()
    })
    // 后台扫一次缺失文件，不阻塞 UI。结果回填 missingTakeIds 让 Inspector 标徽
    void window.api.audioAudit.scan().then((result) => {
      // 期间用户可能已经关掉 / 切到别的工程；只在仍是同一工程时回填
      const cur = useEditorStore.getState()
      if (cur.projectPath !== bundle.path) return
      cur.setMissingTakeIds(result.missing.map((m) => m.takeId))
    })
  },

  clear: () => {
    // 切换工程时若 segments 还有 pending 保存，直接丢弃定时器——
    // 此时前一份工程的锁即将释放，保存已经来不及了（close 已经 flush 过 workspace）。
    if (segmentsSaveTimer) {
      clearTimeout(segmentsSaveTimer)
      segmentsSaveTimer = null
    }
    useHistoryStore.getState().clear()
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
      paused: false,
      saved: true,
      recordingSegmentId: null,
      recordingTakeId: null,
      missingTakeIds: new Set<string>()
    })
  },

  setMissingTakeIds: (takeIds) => set({ missingTakeIds: new Set(takeIds) }),

  applyRemapResult: (segmentId, takeId, durationMs) => {
    set((state) => {
      const seg = state.segmentsById[segmentId]
      if (!seg) return state
      const idx = seg.takes.findIndex((t) => t.id === takeId)
      if (idx < 0) return state
      const nextTakes = seg.takes.slice()
      nextTakes[idx] = { ...nextTakes[idx], durationMs }
      // 从 missingTakeIds 移除：复制一份新 Set 以保持引用替换语义
      const nextMissing = new Set(state.missingTakeIds)
      nextMissing.delete(takeId)
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...seg, takes: nextTakes }
        },
        missingTakeIds: nextMissing,
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  appendTakeFromOrphan: (segmentId, take) => {
    set((state) => {
      const seg = state.segmentsById[segmentId]
      if (!seg) return state
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...seg, takes: [...seg.takes, take] }
        },
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  applyHistoryPatch: (patch) => {
    let dirty = false
    set((state) => {
      const delta = patch(state)
      if (!delta) return state
      dirty = true
      return { ...delta, ...markDirty() }
    })
    if (dirty) {
      scheduleSegmentsSave()
      // selectedSegmentId 可能被 revert 改动，同步一份 workspace 到 main
      pushWorkspace(get())
    }
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
    const prev = get()
    const segments = splitScriptIntoSegments(rawText)
    const segmentsById: Record<string, Segment> = {}
    for (const s of segments) segmentsById[s.id] = s
    const afterOrder = segments.map((s) => s.id)
    const afterSelected = segments[0]?.id

    // importScript 是覆盖式操作，before / after 都要完整记录；
    // 未来改成追加式时只需换这一处的 before / after 构造方式，命令类型不用动
    useHistoryStore.getState().push('importScript', 'history.import_script', {
      type: 'importScript',
      beforeOrder: prev.order.slice(),
      beforeSegmentsById: { ...prev.segmentsById },
      beforeSelectedSegmentId: prev.selectedSegmentId,
      afterOrder: afterOrder.slice(),
      afterSegmentsById: { ...segmentsById },
      afterSelectedSegmentId: afterSelected
    })

    set({
      order: afterOrder,
      segmentsById,
      selectedSegmentId: afterSelected,
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  editSegmentText: (id, text) => {
    const prev = get()
    const seg = prev.segmentsById[id]
    if (!seg || seg.text === text) return

    // 同一 Segment 连续打字在 coalesce 窗内合并为一条，避免每个按键一格 undo
    useHistoryStore.getState().push(`editText:${id}`, 'history.edit_text', {
      type: 'editText',
      segId: id,
      before: seg.text,
      after: text
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [id]: { ...seg, text }
      },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  /**
   * 替换式重排：调用方传入整份新的 order 数组。
   * 既服务拖拽（UI 算好新顺序后一次性传入），也方便后续加「批量排序」等功能。
   * 我们只做长度和成员校验，防御 UI bug 把 order 污染掉。
   */
  reorderSegments: (nextOrder) => {
    const prev = get()
    if (nextOrder.length !== prev.order.length) return
    // 成员必须和旧 order 完全一致，仅顺序不同
    const currentSet = new Set(prev.order)
    for (const id of nextOrder) {
      if (!currentSet.has(id)) return
    }
    // 顺序未变则不写盘，也不入栈
    const same = nextOrder.every((id, i) => id === prev.order[i])
    if (same) return

    useHistoryStore.getState().push('reorder', 'history.reorder', {
      type: 'reorder',
      before: prev.order.slice(),
      after: nextOrder.slice()
    })

    set({ order: nextOrder.slice(), ...markDirty() })
    scheduleSegmentsSave()
  },

  deleteSegment: (id) => {
    const prev = get()
    const seg = prev.segmentsById[id]
    if (!seg) return
    const removedIdx = prev.order.indexOf(id)
    const nextOrder = prev.order.filter((oid) => oid !== id)
    const nextById = { ...prev.segmentsById }
    delete nextById[id]
    // 选中态跟随：若删除的是当前选中段，自动选相邻段（优先后一个，没有就前一个，都没有就清空）
    let nextSelected = prev.selectedSegmentId
    if (nextSelected === id) {
      nextSelected = nextOrder[removedIdx] ?? nextOrder[removedIdx - 1]
    }

    // 保存完整 Segment（含所有 Takes），这样 undo 能原样还原；
    // 即便之后 takes 被别的操作动过，这个 cmd 依然还原删除那一刻的状态
    useHistoryStore.getState().push(`deleteSegment:${id}`, 'history.delete_segment', {
      type: 'deleteSegment',
      id,
      index: removedIdx,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: nextSelected
    })

    set({
      order: nextOrder,
      segmentsById: nextById,
      selectedSegmentId: nextSelected,
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  setSelectedTake: (segmentId, takeId) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg || seg.selectedTakeId === takeId) return

    useHistoryStore.getState().push(`setSelectedTake:${segmentId}`, 'history.set_selected_take', {
      type: 'setSelectedTake',
      segId: segmentId,
      before: seg.selectedTakeId,
      after: takeId
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [segmentId]: { ...seg, selectedTakeId: takeId }
      },
      ...markDirty()
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
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const removedIdx = seg.takes.findIndex((t) => t.id === takeId)
    if (removedIdx < 0) return
    const removedTake = seg.takes[removedIdx]

    const nextTakes = seg.takes.filter((t) => t.id !== takeId)
    let nextSelectedTakeId = seg.selectedTakeId
    if (nextSelectedTakeId === takeId) {
      const neighbor = nextTakes[removedIdx] ?? nextTakes[removedIdx - 1]
      nextSelectedTakeId = neighbor?.id
    }

    // deleteTake 只改 segments.json，不删 WAV 文件（孤儿由专用清理工具处理）。
    // 这个设计让 undo 变得简单：revert 时 Take 引用恢复，磁盘文件原本就还在，
    // 不需要做任何 IO
    useHistoryStore.getState().push(`deleteTake:${segmentId}:${takeId}`, 'history.delete_take', {
      type: 'deleteTake',
      segId: segmentId,
      takeIndex: removedIdx,
      take: removedTake,
      prevSelectedTakeId: seg.selectedTakeId,
      nextSelectedTakeId
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [segmentId]: {
          ...seg,
          takes: nextTakes,
          selectedTakeId: nextSelectedTakeId
        }
      },
      ...markDirty()
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
      showError(i18n.t('errors.recording_start_title'), (err as Error).message)
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
      showError(i18n.t('errors.recording_start_title'), (err as Error).message)
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
      showError(i18n.t('errors.recording_stop_title'), (err as Error).message)
      return
    }

    const writeRes = await window.api.recording.writeTake(segmentId, takeId, result.buffer)
    if (!writeRes.ok) {
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
      showError(i18n.t('errors.recording_persist_title'), writeRes.message)
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
    const items: Array<{ segmentId: string; filePath: string }> = []
    for (const id of state.order) {
      const seg = state.segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      if (take) items.push({ segmentId: id, filePath: take.filePath })
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
