import { promises as fs } from 'fs'
import {
  makeEmptySegmentsFile,
  makeEmptyWorkspaceFile,
  PROJECT_SCHEMA_VERSION,
  SEGMENTS_SCHEMA_VERSION,
  WORKSPACE_SCHEMA_VERSION,
  type ProjectFile,
  type SegmentsFile,
  type WorkspaceFile
} from '@shared/project'
import { writeJsonAtomic } from '../lib/atomic-write'
import { projectPaths } from './paths'

/**
 * 工程文件 IO。
 *
 * 约定：
 *   - project.json / segments.json 属于工程内容，写入必须原子
 *   - workspace.json 属于工作区上下文，写入也用原子，但失败不致命
 *   - 解析失败的处理策略在「数据完整性与恢复」章节：
 *       project.json / segments.json 硬报错
 *       workspace.json 回落到空默认
 */

export class ProjectFileError extends Error {
  constructor(
    message: string,
    readonly file: 'project.json' | 'segments.json'
  ) {
    super(message)
    this.name = 'ProjectFileError'
  }
}

async function readJson<T>(path: string): Promise<T> {
  const raw = await fs.readFile(path, 'utf8')
  return JSON.parse(raw) as T
}

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------

export async function loadProjectFile(dir: string): Promise<ProjectFile> {
  const { projectFile } = projectPaths(dir)
  let parsed: ProjectFile
  try {
    parsed = await readJson<ProjectFile>(projectFile)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      throw new ProjectFileError(`project.json 不存在：${projectFile}`, 'project.json')
    }
    throw new ProjectFileError(`project.json 解析失败：${e.message}`, 'project.json')
  }

  if (parsed.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    // 开发阶段暂不做跨版本迁移（见「仍待明确」条目：Schema 版本迁移工具）。
    // 遇到未知版本时直接拒绝打开，避免读入不兼容的数据结构。
    throw new ProjectFileError(
      `project.json schemaVersion ${parsed.schemaVersion} 不受支持`,
      'project.json'
    )
  }
  return parsed
}

export async function saveProjectFile(dir: string, file: ProjectFile): Promise<void> {
  await writeJsonAtomic(projectPaths(dir).projectFile, file)
}

// ---------------------------------------------------------------------------
// segments.json
// ---------------------------------------------------------------------------

export async function loadSegmentsFile(dir: string): Promise<SegmentsFile> {
  const { segmentsFile } = projectPaths(dir)
  let parsed: SegmentsFile
  try {
    parsed = await readJson<SegmentsFile>(segmentsFile)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      // 新工程刚建立时还没有 segments.json，视为空段落表。
      return makeEmptySegmentsFile()
    }
    throw new ProjectFileError(`segments.json 解析失败：${e.message}`, 'segments.json')
  }
  if (parsed.schemaVersion !== SEGMENTS_SCHEMA_VERSION) {
    throw new ProjectFileError(
      `segments.json schemaVersion ${parsed.schemaVersion} 不受支持`,
      'segments.json'
    )
  }
  return parsed
}

export async function saveSegmentsFile(dir: string, file: SegmentsFile): Promise<void> {
  await writeJsonAtomic(projectPaths(dir).segmentsFile, file)
}

// ---------------------------------------------------------------------------
// workspace.json
// ---------------------------------------------------------------------------

export async function loadWorkspaceFile(dir: string): Promise<WorkspaceFile> {
  const { workspaceFile } = projectPaths(dir)
  try {
    const parsed = await readJson<WorkspaceFile>(workspaceFile)
    if (parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
      // workspace 丢失不影响工程，未知版本直接回落到空
      console.warn(
        `[project-storage] workspace.json schemaVersion ${parsed.schemaVersion} 不识别，使用空默认`
      )
      return makeEmptyWorkspaceFile()
    }
    return parsed
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      console.warn(`[project-storage] workspace.json 加载失败，使用空默认：${e.message}`)
    }
    return makeEmptyWorkspaceFile()
  }
}

export async function saveWorkspaceFile(dir: string, file: WorkspaceFile): Promise<void> {
  await writeJsonAtomic(projectPaths(dir).workspaceFile, file)
}

// ---------------------------------------------------------------------------
// 新建工程骨架（建空目录结构 + 写初始 JSON）
// ---------------------------------------------------------------------------

export async function writeProjectSkeleton(dir: string, project: ProjectFile): Promise<void> {
  const paths = projectPaths(dir)
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(paths.audiosDir, { recursive: true })
  await fs.mkdir(paths.tempDir, { recursive: true })
  await saveProjectFile(dir, project)
  await saveSegmentsFile(dir, makeEmptySegmentsFile())
  await saveWorkspaceFile(dir, makeEmptyWorkspaceFile())
}
