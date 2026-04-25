import type { ProjectBundle } from '@shared/project'
import type { PlaybackMode, Project, Segment, Take } from '@renderer/types/project'

/**
 * editorStore 类型层。把数据字段（EditorData）与动作字段（EditorActions）分开
 * 便于：
 *   - INITIAL_STATE 仅描述「数据」初值，不包含 action 闭包，使 lifecycle slice
 *     的 clear() 可以直接 spread 这一份常量
 *   - 各 slice 文件只需要 import 自己关心的子类型，编辑时类型噪声更少
 *
 * 对外仍 export 合并后的 EditorState，所有调用方（视图 / 历史 / 服务）一律
 * 通过它取数。
 */

// ---------------------------------------------------------------------------
// 数据字段
// ---------------------------------------------------------------------------

export type EditorData = {
  /** 工程目录的绝对路径；仅在内存和 IPC 中流通，不会写入任何工程文件 */
  projectPath: string | null
  /** 当前打开的工程元信息；null 表示没有活动工程 */
  project: Project | null
  order: string[]
  segmentsById: Record<string, Segment>

  selectedSegmentId: string | undefined
  /**
   * 项目时间轴游标位置（毫秒）。
   *
   * 语义：「下一次播放将从这里起播」+「最近一次空闲态时游标停在哪」。
   * 与 selectedSegmentId 解耦——前者是「时间维度上的位置」，后者是「文档
   * 维度上的选中」。播放期间 UI 显示的是实际播放进度（不更新这里），停止
   * 或自然结束后游标停留在最终位置
   */
  timelinePlayheadMs: number
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
  /** SegmentTimeline 波形横向缩放（log 映射，slider 操作的目标值） */
  waveformZoomH: number
  /** SegmentTimeline 波形纵向缩放 */
  waveformZoomV: number

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
}

// ---------------------------------------------------------------------------
// 动作字段
// ---------------------------------------------------------------------------

export type EditorActions = {
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

  /**
   * 更新工程元信息（project.json）。立即应用到内存 + 通过 IPC 写盘。
   * 不进 undo 栈——meta 是配置类数据，通过 ProjectSettingsView 编辑，
   * 用户期待「点了立刻生效」而不是「需要 Ctrl+Z 反复试错」
   */
  updateProject: (patch: Partial<Project>) => void

  // 工作区（UI 上下文）
  selectSegment: (id: string | undefined) => void
  /**
   * 多选友好的版本：
   *   - mode 'single'：清空副选中，把 id 设为主选（普通点击）
   *   - mode 'toggle'：在副选中里切换 id（Ctrl/Cmd+Click）。被切到主选的
   *     位置时如果 id 是当前主选，主选保留，副选切换 id；如果 id 不是主选,
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
  /** 设置时间轴游标位置（毫秒）。会被 clamp 到 [0, +∞)；超过项目总时长由 UI 自行处理 */
  setTimelinePlayhead: (ms: number) => void
  /**
   * 设置波形缩放档位。仅写入指定的轴（h / v），未传的轴保持不变——slider /
   * 滚轮一次只动一个轴，避免连带覆盖另一轴
   */
  setWaveformZoom: (patch: { h?: number; v?: number }) => void

  // Segment / Take 编辑
  importScript: (rawText: string) => void
  editSegmentText: (id: string, text: string) => void
  deleteSegment: (id: string) => void
  reorderSegments: (nextOrder: string[]) => void
  setSelectedTake: (segmentId: string, takeId: string) => void
  deleteTake: (segmentId: string, takeId: string) => void
  /**
   * 设置 Take 的节选区间（毫秒，相对文件起点）。
   *
   *   - trim === undefined：清除节选，恢复整段播放（字段从 Take 上删除）
   *   - 其他：写入 trimStartMs / trimEndMs。end <= start / 越界由调用方
   *     已 clamp 后传入；进 undo 栈
   */
  setTakeTrim: (
    segmentId: string,
    takeId: string,
    trim: { startMs: number; endMs: number } | undefined
  ) => void
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
   * 设置 / 取消某个 Segment 的「段首」标记。值为 false 时把字段置 undefined,
   * 节省存储 + 让「无段落信息」与「显式非段首」语义一致
   */
  setParagraphStart: (segmentId: string, value: boolean) => void
  /**
   * 全局文本替换：把所有 Segment text 中出现的 find 全部换成 replaceWith。
   * 大小写敏感、子串匹配。返回实际改动的 Segment 数量供 UI 反馈
   */
  replaceAllInSegments: (find: string, replaceWith: string) => number
  /**
   * 设置 / 清除某个 Segment 的 gapAfter（其后的空白间隔）。
   * gap === undefined 等价于「无间隔」（数据上把字段删除）。
   * manual: true 表示用户手动设置，applyDefaultGaps 跳过此段
   */
  setSegmentGap: (segmentId: string, gap: { ms: number; manual?: boolean } | undefined) => void
  /**
   * 一键应用默认间隔：跳过 manual === true 的 segment，给其他段写入
   * 句间 / 段间默认值。最后一段的 gapAfter 不写（拼接导出时无意义）
   */
  applyDefaultGaps: (defaults: { sentenceMs: number; paragraphMs: number }) => void
  /**
   * 强制把所有段（含 manual）重置为默认值。和 applyDefaultGaps 的区别：
   * 这条会覆盖用户的手动设置（manual 字段也被清掉）。用户「想从头来过」时使用
   */
  resetGapsToDefault: (defaults: { sentenceMs: number; paragraphMs: number }) => void
  /**
   * 清除所有「非手动」的段间间隔。manual === true 的段保留。
   * 反向操作：让用户先做整体清零，再手动从零开始构建间隔
   */
  clearAutoGaps: () => void

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

export type EditorState = EditorData & EditorActions

// ---------------------------------------------------------------------------
// slice creator 工具类型
// ---------------------------------------------------------------------------

/**
 * 标准 zustand setter 形态。后期切换到 immer / devtools 时也只动这一处。
 *
 * 我们不用 zustand 推荐的「StateCreator<EditorState, ...>」泛型链，那玩意
 * 在多 slice + 增强器混合时签名会膨胀；本项目无 middleware，用最朴素的
 * (set, get) 双参形式更直观。
 */
export type EditorSet = (
  partial: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)
) => void
export type EditorGet = () => EditorState

/**
 * 单个 slice 的工厂函数：返回这个 slice 负责的字段子集。所有 slice 共享
 * 同一个 set / get，因此可以读写 store 里任何字段——slice 切分只是组织
 * 代码的边界，不是运行时隔离。
 */
export type SliceCreator<T extends Partial<EditorState>> = (set: EditorSet, get: EditorGet) => T

// ---------------------------------------------------------------------------
// 数据初值（lifecycle 的 clear / applyBundle 都会用）
// ---------------------------------------------------------------------------

export const INITIAL_DATA: EditorData = {
  projectPath: null,
  project: null,
  order: [],
  segmentsById: {},
  selectedSegmentId: undefined,
  timelinePlayheadMs: 0,
  extraSelectedSegmentIds: new Set<string>(),
  lastPreviewedTakeId: undefined,
  scriptListScrollTop: 0,
  timelineScrollLeft: 0,
  timelineZoom: 1,
  waveformZoomH: 1,
  waveformZoomV: 1,
  playback: 'idle',
  paused: false,
  saved: true,
  recordingSegmentId: null,
  recordingTakeId: null,
  countdownRemaining: 0,
  missingTakeIds: new Set<string>()
}
