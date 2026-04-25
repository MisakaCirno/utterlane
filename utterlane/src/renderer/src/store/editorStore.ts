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
import { usePreferencesStore } from '@renderer/store/preferencesStore'
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
  /**
   * 主选中之外的「副选中」集合，用于多选场景。
   *
   * 不变量：selectedSegmentId（主选中）永远不会出现在 extraSelectedSegmentIds
   * 里——避免渲染时一行同时被两份样式覆盖。删除 / 主选中变化时由 store 自己
   * 维护这个不变量
   */
  extraSelectedSegmentIds: ReadonlySet<string>
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
   * 倒计时剩余秒数，仅在 playback === 'countdown' 时有意义。
   * UI 通过它渲染大数字。每秒递减一次，到 0 时切到 'recording'。
   */
  countdownRemaining: number

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
  /**
   * 多选友好的版本：
   *   - mode 'single'：清空副选中，把 id 设为主选（普通点击）
   *   - mode 'toggle'：在副选中里切换 id（Ctrl/Cmd+Click）。被切到主选的
   *     位置时如果 id 是当前主选，主选保留，副选切换 id；如果 id 不是主选，
   *     id 加 / 减出副选集合
   *   - mode 'range'：把当前主选与 id 之间所有 segments 全部加进副选
   *     （Shift+Click），id 自身成为新的主选
   */
  selectSegmentExtended: (id: string, mode: 'single' | 'toggle' | 'range') => void
  /** 清空副选中。Esc / 普通点击其他段时调 */
  clearExtraSelection: () => void
  /**
   * 批量删除当前选中（主选 + 副选）的所有 Segment。空选时 no-op。
   * 进 undo 栈（一条 deleteSegmentsBatch 命令），revert 时整批还原
   */
  deleteSelectedSegments: () => void
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
  /**
   * 在 splitAt 字符位置把指定 Segment 拆成两个。
   * 前半段保留原 Segment（含所有 Take）；后半段是新建空 Take 的 Segment，
   * 紧跟原 Segment 在 order 中的下一位插入
   */
  splitSegmentAt: (segmentId: string, splitAt: number) => void
  /**
   * 把指定 Segment 合并到它的前一段。文本拼接（中间加空格），
   * takes 列表 append 到前一段。前一段的 selectedTakeId 不变；
   * 当前段不存在前一段（已经是首段）时 no-op
   */
  mergeSegmentWithPrevious: (segmentId: string) => void
  /**
   * 末尾追加一个空白 Segment。返回新 Segment 的 id 让调用方继续自动选中 / 滚动
   */
  newSegment: (text?: string) => string
  /** 在指定 Segment 之前插入一个空白 Segment，自动选中新段。无引用时 no-op */
  insertSegmentBefore: (refId: string, text?: string) => string | null
  /** 在指定 Segment 之后插入一个空白 Segment，自动选中新段。无引用时 no-op */
  insertSegmentAfter: (refId: string, text?: string) => string | null
  /** 清空所有 Segment（进 undo 栈，可还原） */
  clearAllSegments: () => void
  /**
   * 设置 / 取消某个 Segment 的「段首」标记。值为 false 时把字段置 undefined，
   * 节省存储 + 让「无段落信息」与「显式非段首」语义一致
   */
  setParagraphStart: (segmentId: string, value: boolean) => void
  /**
   * 全局文本替换：把所有 Segment text 中出现的 find 全部换成 replaceWith。
   * 大小写敏感、子串匹配。返回实际改动的 Segment 数量供 UI 反馈
   */
  replaceAllInSegments: (find: string, replaceWith: string) => number

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

  /**
   * Dev-only：在末尾追加 N 条假 Segment（仅 text，无 takes），用于
   * 测试虚拟化 / 大工程渲染性能。直接走 setState + scheduleSegmentsSave，
   * 不进 undo 栈——纯测试用途，不要污染历史
   */
  __dev_appendFakeSegments: (count: number) => void

  // 录音
  startRecordingForSelected: () => Promise<void>
  /** 重录：覆盖当前选中 Take 的音频文件，selectedTakeId 不变 */
  startRerecordingSelected: () => Promise<void>
  stopRecordingAndSave: () => Promise<void>
  cancelRecording: () => Promise<void>
  /** 用户在倒计时阶段按 Esc：直接回到 idle，不进入 recording */
  cancelCountdown: () => void

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
//
// 规则：
//   - 去除行首尾空白
//   - 单个空行视为段落边界：下一个非空行的 Segment 标记 paragraphStart = true
//   - 连续多个空行折叠成一次段落边界（不会产生空段）
//   - 第一段第一句默认 paragraphStart = true
//
// Segment id 用 crypto.randomUUID。
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

/**
 * Segment.text 的数据不变量：单行、不含制表符。
 *
 * 把 \r \n \t 等「结构性」空白字符塌缩成一个普通空格，让一段文字永远是
 * 单行（导出 SRT 时一行字幕对应一段文字、时间轴 / 波形 / 字幕长度都不会
 * 因为多行而错乱）。普通的多空格不动——用户可能有意为之（停顿表达 / 输入
 * 错误恢复都常见）。
 *
 * trim 不在这里做：编辑过程中用户可能正在打头空格 / 尾空格，store 层 trim
 * 会让光标跳。提交（blur / Enter）时再由 UI 显式 trim
 */
export function sanitizeSegmentText(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ')
}

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

function splitScriptIntoSegments(rawText: string): Segment[] {
  const lines = rawText.split(/\r?\n/)
  const segments: Segment[] = []
  // 第一段段首：首次进循环时 nextIsParagraphStart 为 true，遇到空行后再次置 true
  let nextIsParagraphStart = true
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) {
      nextIsParagraphStart = true
      continue
    }
    const seg: Segment = {
      id: crypto.randomUUID(),
      text: line,
      takes: []
    }
    // paragraphStart 仅在 true 时落字段，false 用 undefined 表达更省字节
    if (nextIsParagraphStart) seg.paragraphStart = true
    segments.push(seg)
    nextIsParagraphStart = false
  }
  return segments
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
  extraSelectedSegmentIds: new Set<string>(),
  lastPreviewedTakeId: undefined,
  scriptListScrollTop: 0,
  timelineScrollLeft: 0,
  timelineZoom: 1,

  playback: 'idle',
  paused: false,
  saved: true,
  recordingSegmentId: null,
  recordingTakeId: null,
  countdownRemaining: 0,
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
      extraSelectedSegmentIds: new Set<string>(),
      lastPreviewedTakeId: bundle.workspace.lastPreviewedTakeId,
      scriptListScrollTop: bundle.workspace.scriptListScrollTop ?? 0,
      timelineScrollLeft: bundle.workspace.timelineScrollLeft ?? 0,
      timelineZoom: bundle.workspace.timelineZoom ?? 1,
      playback: 'idle',
      paused: false,
      saved: true,
      recordingSegmentId: null,
      recordingTakeId: null,
      countdownRemaining: 0,
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
      extraSelectedSegmentIds: new Set<string>(),
      lastPreviewedTakeId: undefined,
      scriptListScrollTop: 0,
      timelineScrollLeft: 0,
      timelineZoom: 1,
      playback: 'idle',
      paused: false,
      saved: true,
      recordingSegmentId: null,
      recordingTakeId: null,
      countdownRemaining: 0,
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
    // 普通选中也清空副选——保持「主选变化时副选不孤立」的语义
    set({ selectedSegmentId: id, extraSelectedSegmentIds: new Set() })
    pushWorkspace(get())
  },

  selectSegmentExtended: (id, mode) => {
    const state = get()
    if (mode === 'single') {
      set({ selectedSegmentId: id, extraSelectedSegmentIds: new Set() })
      pushWorkspace(get())
      return
    }
    if (mode === 'toggle') {
      // Ctrl/Cmd+Click：在副选中里加 / 减，主选不变。但如果点的就是当前主选，
      // 则保持主选不动（用户可能在矫正误操作）。如果之前没主选，把 id 设为主选
      if (!state.selectedSegmentId) {
        set({ selectedSegmentId: id })
        pushWorkspace(get())
        return
      }
      if (id === state.selectedSegmentId) return
      const next = new Set(state.extraSelectedSegmentIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ extraSelectedSegmentIds: next })
      return
    }
    // mode === 'range'：从当前主选到 id 的连续区间全部进副选，id 成为新的主选。
    // 没有主选时退化成 single
    if (!state.selectedSegmentId) {
      set({ selectedSegmentId: id, extraSelectedSegmentIds: new Set() })
      pushWorkspace(get())
      return
    }
    const fromIdx = state.order.indexOf(state.selectedSegmentId)
    const toIdx = state.order.indexOf(id)
    if (fromIdx < 0 || toIdx < 0) return
    const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
    const range = state.order.slice(lo, hi + 1)
    const next = new Set(range)
    next.delete(id) // id 是新主选，不进副选集合
    set({ selectedSegmentId: id, extraSelectedSegmentIds: next })
    pushWorkspace(get())
  },

  clearExtraSelection: () => {
    if (get().extraSelectedSegmentIds.size === 0) return
    set({ extraSelectedSegmentIds: new Set() })
  },

  deleteSelectedSegments: () => {
    const prev = get()
    // 主选 + 副选合并成完整的待删 ID 集合
    const targetIds = new Set(prev.extraSelectedSegmentIds)
    if (prev.selectedSegmentId) targetIds.add(prev.selectedSegmentId)
    if (targetIds.size === 0) return

    // 收集每个待删 Segment 在原 order 中的下标，排序后塞进命令的 removed
    const removed: Array<{ index: number; segment: Segment }> = []
    for (let i = 0; i < prev.order.length; i++) {
      const id = prev.order[i]
      if (targetIds.has(id)) {
        const seg = prev.segmentsById[id]
        if (seg) removed.push({ index: i, segment: seg })
      }
    }
    if (removed.length === 0) return

    // 计算删除后的主选：取被删除区域的下一个未删段；都没有就向前找
    const firstRemovedIdx = removed[0].index
    let nextSelected: string | undefined
    for (let i = firstRemovedIdx; i < prev.order.length; i++) {
      if (!targetIds.has(prev.order[i])) {
        nextSelected = prev.order[i]
        break
      }
    }
    if (!nextSelected) {
      for (let i = firstRemovedIdx - 1; i >= 0; i--) {
        if (!targetIds.has(prev.order[i])) {
          nextSelected = prev.order[i]
          break
        }
      }
    }

    useHistoryStore
      .getState()
      .push(`deleteSegmentsBatch:${removed.length}`, 'history.delete_segments_batch', {
        type: 'deleteSegmentsBatch',
        removed,
        prevSelectedSegmentId: prev.selectedSegmentId,
        nextSelectedSegmentId: nextSelected
      })

    const nextById = { ...prev.segmentsById }
    for (const { segment } of removed) delete nextById[segment.id]
    set({
      order: prev.order.filter((id) => !targetIds.has(id)),
      segmentsById: nextById,
      selectedSegmentId: nextSelected,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
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
    if (!seg) return
    // 数据不变量：Segment.text 单行。任何入口（粘贴 / textarea Enter /
    // 历史遗留多行）都在这里折成空格。trim 不在 store 层做——edit 过程
    // 中的中间态可能有前后空格，trim 由 UI 在 commit / blur 时显式做
    const sanitized = sanitizeSegmentText(text)
    if (seg.text === sanitized) return

    // 同一 Segment 连续打字在 coalesce 窗内合并为一条，避免每个按键一格 undo
    useHistoryStore.getState().push(`editText:${id}`, 'history.edit_text', {
      type: 'editText',
      segId: id,
      before: seg.text,
      after: sanitized
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [id]: { ...seg, text: sanitized }
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

  /**
   * 拆分行为：
   *   - splitAt 落在 [1, text.length-1] 才有意义；落在两端会产生空 Segment，no-op
   *   - 前半段（保留原 ID）：text[0..splitAt]，takes / selectedTakeId 不动
   *   - 后半段（新 ID）：text[splitAt..]，无 takes，紧跟原段插入
   *   - selectedSegmentId 保持原段（用户拆分通常是想精修前半段）
   * 拆分动作进 undo 栈，inverse 直接把后半段删除并合并文本回去
   */
  splitSegmentAt: (segmentId, splitAt) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const text = seg.text
    // 越界保护：拆分点必须落在文本中段，否则一段空一段全的拆没意义
    if (splitAt <= 0 || splitAt >= text.length) return
    const sourceIdx = prev.order.indexOf(segmentId)
    if (sourceIdx < 0) return

    const newSegmentId = crypto.randomUUID()
    const beforeText = text.slice(0, splitAt).trimEnd()
    const afterText = text.slice(splitAt).trimStart()
    if (beforeText.length === 0 || afterText.length === 0) return

    useHistoryStore.getState().push(`splitSegment:${segmentId}`, 'history.split_segment', {
      type: 'splitSegment',
      sourceSegmentId: segmentId,
      sourceTextBefore: text,
      splitAt,
      newSegmentId,
      newSegmentIndex: sourceIdx + 1,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: prev.selectedSegmentId
    })

    const nextOrder = prev.order.slice()
    nextOrder.splice(sourceIdx + 1, 0, newSegmentId)
    set({
      order: nextOrder,
      segmentsById: {
        ...prev.segmentsById,
        [segmentId]: { ...seg, text: beforeText },
        [newSegmentId]: { id: newSegmentId, text: afterText, takes: [] }
      },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  /**
   * 合并行为：
   *   - 必须存在「前一段」（segmentId 在 order 中 idx > 0），否则 no-op
   *   - 文本：`${prev.text} ${curr.text}`（中间加空格；不区分中英文，
   *     用户合完可以再编辑）。两端先 trim 避免多余空白
   *   - takes：append curr.takes 到 prev.takes 末尾。selectedTakeId 不动
   *     （前一段原本选哪个还选哪个）
   *   - selectedSegmentId 切到 target（前一段），让 Inspector 立刻显示合完的文本
   */
  mergeSegmentWithPrevious: (segmentId) => {
    const prev = get()
    const idx = prev.order.indexOf(segmentId)
    if (idx <= 0) return // 已经是首段，无前一段可合
    const targetId = prev.order[idx - 1]
    const target = prev.segmentsById[targetId]
    const curr = prev.segmentsById[segmentId]
    if (!target || !curr) return

    const targetTextBefore = target.text
    const targetTakesBefore = target.takes
    const mergedText = `${target.text.trim()} ${curr.text.trim()}`.trim()

    useHistoryStore.getState().push(`mergeSegment:${segmentId}`, 'history.merge_segment', {
      type: 'mergeSegment',
      targetSegmentId: targetId,
      targetTextBefore,
      targetTextAfter: mergedText,
      targetTakesBefore,
      mergedSegment: curr,
      mergedIndex: idx,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: targetId
    })

    const nextOrder = prev.order.filter((id) => id !== segmentId)
    const nextById = { ...prev.segmentsById }
    delete nextById[segmentId]
    nextById[targetId] = {
      ...target,
      text: mergedText,
      takes: [...targetTakesBefore, ...curr.takes]
    }
    set({
      order: nextOrder,
      segmentsById: nextById,
      selectedSegmentId: targetId,
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  __dev_appendFakeSegments: (count) => {
    const prev = get()
    const newSegs: Segment[] = []
    for (let i = 0; i < count; i++) {
      const idx = prev.order.length + i + 1
      newSegs.push({
        id: crypto.randomUUID(),
        text: `[Dev] Segment ${idx} - Lorem ipsum dolor sit amet, consectetur adipiscing elit ${idx}.`,
        takes: []
      })
    }
    const nextById = { ...prev.segmentsById }
    for (const s of newSegs) nextById[s.id] = s
    set({
      order: [...prev.order, ...newSegs.map((s) => s.id)],
      segmentsById: nextById,
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  newSegment: (text) => {
    const prev = get()
    const newId = crypto.randomUUID()
    const seg: Segment = { id: newId, text: text ?? '', takes: [] }
    const insertIdx = prev.order.length
    useHistoryStore.getState().push(`insertSegment:${newId}`, 'history.insert_segment', {
      type: 'insertSegment',
      index: insertIdx,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: newId
    })
    set({
      order: [...prev.order, newId],
      segmentsById: { ...prev.segmentsById, [newId]: seg },
      selectedSegmentId: newId,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
    return newId
  },

  insertSegmentBefore: (refId, text) => {
    const prev = get()
    const refIdx = prev.order.indexOf(refId)
    if (refIdx < 0) return null
    const newId = crypto.randomUUID()
    const seg: Segment = { id: newId, text: text ?? '', takes: [] }
    useHistoryStore.getState().push(`insertSegment:${newId}`, 'history.insert_segment_before', {
      type: 'insertSegment',
      index: refIdx,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: newId
    })
    const nextOrder = prev.order.slice()
    nextOrder.splice(refIdx, 0, newId)
    set({
      order: nextOrder,
      segmentsById: { ...prev.segmentsById, [newId]: seg },
      selectedSegmentId: newId,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
    return newId
  },

  insertSegmentAfter: (refId, text) => {
    const prev = get()
    const refIdx = prev.order.indexOf(refId)
    if (refIdx < 0) return null
    const newId = crypto.randomUUID()
    const seg: Segment = { id: newId, text: text ?? '', takes: [] }
    useHistoryStore.getState().push(`insertSegment:${newId}`, 'history.insert_segment_after', {
      type: 'insertSegment',
      index: refIdx + 1,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: newId
    })
    const nextOrder = prev.order.slice()
    nextOrder.splice(refIdx + 1, 0, newId)
    set({
      order: nextOrder,
      segmentsById: { ...prev.segmentsById, [newId]: seg },
      selectedSegmentId: newId,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
    return newId
  },

  clearAllSegments: () => {
    const prev = get()
    if (prev.order.length === 0) return
    useHistoryStore.getState().push('clearSegments', 'history.clear_segments', {
      type: 'clearSegments',
      beforeOrder: prev.order.slice(),
      beforeSegmentsById: { ...prev.segmentsById },
      beforeSelectedSegmentId: prev.selectedSegmentId
    })
    set({
      order: [],
      segmentsById: {},
      selectedSegmentId: undefined,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  setParagraphStart: (segmentId, value) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const before = seg.paragraphStart
    // before 实际是 boolean | undefined；和目标值都规范成 boolean 再比较
    if (!!before === value) return
    useHistoryStore
      .getState()
      .push(`setParagraphStart:${segmentId}`, 'history.set_paragraph_start', {
        type: 'setParagraphStart',
        segId: segmentId,
        before,
        after: value
      })
    const nextSeg = { ...seg }
    if (value) nextSeg.paragraphStart = true
    else delete nextSeg.paragraphStart
    set({
      segmentsById: { ...prev.segmentsById, [segmentId]: nextSeg },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  replaceAllInSegments: (find, replaceWith) => {
    if (find.length === 0) return 0
    const prev = get()
    const edits: Array<{ segId: string; before: string; after: string }> = []
    for (const id of prev.order) {
      const seg = prev.segmentsById[id]
      if (!seg) continue
      if (!seg.text.includes(find)) continue
      // split + join 比 replaceAll 快，且不依赖 RegExp 转义
      const after = seg.text.split(find).join(replaceWith)
      if (after === seg.text) continue
      edits.push({ segId: id, before: seg.text, after })
    }
    if (edits.length === 0) return 0

    useHistoryStore.getState().push('replaceAll', 'history.replace_all', {
      type: 'replaceAll',
      find,
      replaceWith,
      edits
    })

    const nextById = { ...prev.segmentsById }
    for (const e of edits) {
      const seg = nextById[e.segId]
      if (seg) nextById[e.segId] = { ...seg, text: e.after }
    }
    set({ segmentsById: nextById, ...markDirty() })
    scheduleSegmentsSave()
    return edits.length
  },

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
