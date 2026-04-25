/**
 * 工程（Project）相关的数据结构定义。
 *
 * 这里区分「内存模型」和「文件模型」：
 *   - 内存模型（Project / Segment / Take）是运行时 store 里的数据
 *   - 文件模型（ProjectFile / SegmentsFile / WorkspaceFile）是落盘格式
 *
 * 两者基本一致，但文件模型多了 schemaVersion，且 SegmentsFile 用 order + segmentsById
 * 的范式存储（而不是数组），方便按 ID 查找、避免数组里顺序和内容混在一起。
 */

export const PROJECT_SCHEMA_VERSION = 1
export const SEGMENTS_SCHEMA_VERSION = 1
export const WORKSPACE_SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// 内存模型
// ---------------------------------------------------------------------------

export type Take = {
  id: string
  /** 相对于工程目录的音频文件路径（工程里不保存绝对路径） */
  filePath: string
  /** 录音时长（毫秒），用于 UI 显示和时间轴布局 */
  durationMs: number
}

export type Segment = {
  id: string
  text: string
  takes: Take[]
  selectedTakeId?: string
  /**
   * 该 Segment 是否为所属段落的首段。true = 段首，false / undefined = 非段首。
   *
   * 「段尾」状态不存储——用 deriveParagraphPosition 从「下一个 Segment 是否
   * 为段首 / 当前是否为最后一段」推导出来，避免双字段同步成本（split / merge
   * / 重排时只需关心 paragraphStart 一个字段）。
   *
   * 用于将来导出时区分「句间」和「段间」静音（句间默认间距 vs 段间更长间距）。
   */
  paragraphStart?: boolean
  /**
   * 该 Segment 之后的空白间隔（毫秒）。导出时用作 segment-to-segment 的填充。
   *
   *   - undefined：未设置，导出时回退到 ExportEffects.silencePaddingMs（如果有）
   *   - manual: true：用户手动设置（拖拽 / 单段编辑），applyDefaultGaps 会跳过
   *     该字段不覆盖
   *   - manual: false / undefined：由 applyDefaultGaps 自动写入，下次自动应用
   *     时可以被新的默认值覆盖
   *
   * 最后一段的 gapAfter 在拼接导出中无意义；UI 也不显示 / 不可拖拽
   */
  gapAfter?: {
    ms: number
    manual?: boolean
  }
}

export type Project = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  audio: {
    sampleRate: number
    channels: 1 | 2
  }
  /** 工程内部的相对路径引用 */
  paths: {
    segmentsFile: string
    audiosDir: string
  }
  exportDefaults: {
    audioFormat: 'wav'
    subtitleFormat: 'srt'
  }
  /**
   * 单 Segment 推荐最大字数。0 / undefined = 不限制。
   *
   * 超过推荐字数的 Segment 在 UI 上用红色提示（字数计数器、SegmentsView
   * 行文字），但不阻止用户保存——只是「建议拆分」的视觉提醒。
   *
   * 不同项目可能有不同标准（字幕长度规范 / 单镜头时长上限 / 等），
   * 所以放在 project.json 而不是 preferences.json
   */
  recommendedMaxChars?: number
}

// ---------------------------------------------------------------------------
// 文件模型（持久化格式）
// ---------------------------------------------------------------------------

export type ProjectFile = Project & {
  schemaVersion: number
}

export type SegmentsFile = {
  schemaVersion: number
  /** 段落顺序（排序仅由这里决定，segmentsById 本身无序） */
  order: string[]
  segmentsById: Record<string, Segment>
}

export type WorkspaceFile = {
  schemaVersion: number
  /** 当前选中的 Segment ID */
  selectedSegmentId?: string
  /** 当前选中的 Take ID（在所选 Segment 内） */
  lastPreviewedTakeId?: string
  /** 脚本列表滚动位置 */
  scriptListScrollTop?: number
  /** 时间轴滚动位置 */
  timelineScrollLeft?: number
  /** 时间轴缩放比例 */
  timelineZoom?: number
}

// ---------------------------------------------------------------------------
// 默认值构造器
// ---------------------------------------------------------------------------

/**
 * 构造一个新工程的骨架。调用点：新建工程流程。
 * title 用目录名；id 用 crypto.randomUUID()。
 * audio / projectDefaults 的取值由调用方从 preferences 传入。
 */
export function makeNewProjectFile(params: {
  id: string
  title: string
  sampleRate: number
  channels: 1 | 2
}): ProjectFile {
  const now = new Date().toISOString()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: params.id,
    title: params.title,
    createdAt: now,
    updatedAt: now,
    audio: {
      sampleRate: params.sampleRate,
      channels: params.channels
    },
    paths: {
      segmentsFile: 'segments.json',
      audiosDir: 'audios'
    },
    exportDefaults: {
      audioFormat: 'wav',
      subtitleFormat: 'srt'
    }
  }
}

export function makeEmptySegmentsFile(): SegmentsFile {
  return {
    schemaVersion: SEGMENTS_SCHEMA_VERSION,
    order: [],
    segmentsById: {}
  }
}

export function makeEmptyWorkspaceFile(): WorkspaceFile {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION
  }
}

// ---------------------------------------------------------------------------
// 打开工程时返回给 renderer 的一次性 bundle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 段落位置推导
// ---------------------------------------------------------------------------

/**
 * 一个 Segment 在所属段落中的位置：段首 / 段中 / 段尾 / 单段（既首又尾）。
 * 这是个派生值，仅供 UI 展示，不在数据模型里持久化
 */
export type ParagraphPosition = 'head' | 'middle' | 'tail' | 'singleton'

/**
 * 推导规则：
 *   - 段首 = 在 order 中是第 0 个，或自身 paragraphStart === true
 *   - 段尾 = 在 order 中是最后一个，或下一个 Segment 的 paragraphStart === true
 *   - 同时段首 + 段尾 → singleton（独立成段）
 *   - 否则 middle
 */
export function deriveParagraphPosition(
  order: string[],
  segmentsById: Record<string, Segment>,
  segId: string
): ParagraphPosition {
  const idx = order.indexOf(segId)
  if (idx < 0) return 'middle'
  const seg = segmentsById[segId]
  if (!seg) return 'middle'
  const isHead = idx === 0 || !!seg.paragraphStart
  const next = idx < order.length - 1 ? segmentsById[order[idx + 1]] : null
  const isTail = idx === order.length - 1 || !!next?.paragraphStart
  if (isHead && isTail) return 'singleton'
  if (isHead) return 'head'
  if (isTail) return 'tail'
  return 'middle'
}

/** 打开工程后主进程给 renderer 的完整初始状态 */
export type ProjectBundle = {
  /** 工程目录绝对路径（只在内存 / IPC 中使用，不写入任何工程文件） */
  path: string
  project: Project
  segments: SegmentsFile
  workspace: WorkspaceFile
}
