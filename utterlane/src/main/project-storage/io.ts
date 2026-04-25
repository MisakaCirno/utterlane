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
import { backupBeforeMigration, runMigrations, type Migration } from '../lib/migrations'
import { projectPaths } from './paths'
import { projectMigrations, segmentsMigrations, workspaceMigrations } from './migrations'

/**
 * 工程文件 IO。
 *
 * 约定：
 *   - project.json / segments.json 属于工程内容，写入必须原子
 *   - workspace.json 属于工作区上下文，写入也用原子，但失败不致命
 *   - 解析失败的处理策略在「数据完整性与恢复」章节：
 *       project.json / segments.json 硬报错
 *       workspace.json 回落到空默认
 *   - schemaVersion 不一致时走迁移：低版本升级（自动备份原文件），
 *     高版本拒绝（提示用户升级软件）
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

async function readJsonRaw(path: string): Promise<unknown> {
  const raw = await fs.readFile(path, 'utf8')
  return JSON.parse(raw)
}

/**
 * 提取一个 raw JSON 对象的 schemaVersion。
 * 缺字段或不是数字时返回 0，调用方据此判断是「老到没有版本号」还是「已知版本」。
 */
function readSchemaVersion(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null) return 0
  const v = (raw as { schemaVersion?: unknown }).schemaVersion
  return typeof v === 'number' ? v : 0
}

/**
 * 检查并应用迁移链。返回升级后的对象（如果不需要迁移则原样返回）。
 *
 * 抛错的几种场景：
 *   - version > targetVersion：来自更新版本软件的工程，拒绝降级
 *   - 迁移链断裂（缺某一步的 migrate 函数）：开发者忘记加迁移
 *   - 迁移函数本身抛错：数据无法升级
 *
 * 调用方根据文件等级决定如何处理这些错误：
 *   - project.json / segments.json：抛 ProjectFileError，UI 弹窗
 *   - workspace.json / preferences.json：catch 住，回落到默认值
 */
async function migrateIfNeeded(
  filePath: string,
  raw: unknown,
  version: number,
  targetVersion: number,
  migrations: Migration[],
  label: string
): Promise<unknown> {
  if (version === targetVersion) return raw

  if (version > targetVersion) {
    throw new Error(
      `${label} schemaVersion ${version} 来自更高版本的 Utterlane，请升级软件后再打开`
    )
  }

  // 低版本升级：备份 → 跑迁移 → 原子写回
  await backupBeforeMigration(filePath, version)
  const migrated = runMigrations(raw, version, targetVersion, migrations)
  await writeJsonAtomic(filePath, migrated)
  console.log(
    `[project-storage] migrated ${label} from v${version} to v${targetVersion} (backup saved)`
  )
  return migrated
}

// ---------------------------------------------------------------------------
// project.json
// ---------------------------------------------------------------------------

export async function loadProjectFile(dir: string): Promise<ProjectFile> {
  const { projectFile } = projectPaths(dir)
  let raw: unknown
  try {
    raw = await readJsonRaw(projectFile)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      throw new ProjectFileError(`project.json 不存在：${projectFile}`, 'project.json')
    }
    throw new ProjectFileError(`project.json 解析失败：${e.message}`, 'project.json')
  }

  const version = readSchemaVersion(raw)
  try {
    const migrated = await migrateIfNeeded(
      projectFile,
      raw,
      version,
      PROJECT_SCHEMA_VERSION,
      projectMigrations,
      'project.json'
    )
    return migrated as ProjectFile
  } catch (err) {
    throw new ProjectFileError((err as Error).message, 'project.json')
  }
}

export async function saveProjectFile(dir: string, file: ProjectFile): Promise<void> {
  await writeJsonAtomic(projectPaths(dir).projectFile, file)
}

// ---------------------------------------------------------------------------
// segments.json
// ---------------------------------------------------------------------------

export async function loadSegmentsFile(dir: string): Promise<SegmentsFile> {
  const { segmentsFile } = projectPaths(dir)
  let raw: unknown
  try {
    raw = await readJsonRaw(segmentsFile)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      // 新工程刚建立时还没有 segments.json，视为空段落表。
      return makeEmptySegmentsFile()
    }
    throw new ProjectFileError(`segments.json 解析失败：${e.message}`, 'segments.json')
  }

  const version = readSchemaVersion(raw)
  try {
    const migrated = await migrateIfNeeded(
      segmentsFile,
      raw,
      version,
      SEGMENTS_SCHEMA_VERSION,
      segmentsMigrations,
      'segments.json'
    )
    return migrated as SegmentsFile
  } catch (err) {
    throw new ProjectFileError((err as Error).message, 'segments.json')
  }
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
    const raw = await readJsonRaw(workspaceFile)
    const version = readSchemaVersion(raw)
    try {
      const migrated = await migrateIfNeeded(
        workspaceFile,
        raw,
        version,
        WORKSPACE_SCHEMA_VERSION,
        workspaceMigrations,
        'workspace.json'
      )
      return migrated as WorkspaceFile
    } catch (err) {
      // workspace 丢失不影响工程内容；迁移失败 / 高版本拒绝 一律回落到空默认
      console.warn(
        `[project-storage] workspace.json 迁移失败，使用空默认：`,
        (err as Error).message
      )
      return makeEmptyWorkspaceFile()
    }
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
