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

/** 打开工程后主进程给 renderer 的完整初始状态 */
export type ProjectBundle = {
  /** 工程目录绝对路径（只在内存 / IPC 中使用，不写入任何工程文件） */
  path: string
  project: Project
  segments: SegmentsFile
  workspace: WorkspaceFile
}
