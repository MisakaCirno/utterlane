import { basename } from 'path'
import { randomUUID } from 'crypto'
import {
  makeNewProjectFile,
  type ProjectBundle,
  type SegmentsFile,
  type WorkspaceFile
} from '@shared/project'
import { preferencesStore } from '../preferences'
import {
  loadProjectFile,
  loadSegmentsFile,
  loadWorkspaceFile,
  ProjectFileError,
  saveSegmentsFile,
  saveWorkspaceFile,
  writeProjectSkeleton
} from './io'
import { acquireLock, releaseLock } from './lock'

/**
 * 当前进程「正在打开」的工程状态。
 *
 * 职责：
 *   - 维护当前工程路径（null = 无活动工程，此时 renderer 显示欢迎页）
 *   - 打开 / 新建时走：lock → load / write skeleton → 更新 recentProjects
 *   - 关闭时走：flush pending writes → release lock
 *   - workspace.json 的写入用 debounce（UI 端滚动 / 选中切换会高频触发）
 *
 * 这里只管「打开着的工程」这一份状态；关于 segments.json 的改动
 * 由 Slice C 的编辑流程接入，此处先暴露保存入口。
 */

const WORKSPACE_SAVE_DEBOUNCE_MS = 500
const MAX_RECENT_PROJECTS = 10

export type OpenResult =
  | { ok: true; bundle: ProjectBundle }
  | { ok: false; reason: 'busy'; heldByPid: number }
  | { ok: false; reason: 'invalid'; message: string }

class ProjectSession {
  private currentPath: string | null = null
  private pendingWorkspace: WorkspaceFile | null = null
  private workspaceSaveTimer: NodeJS.Timeout | null = null

  get path(): string | null {
    return this.currentPath
  }

  async open(dir: string): Promise<OpenResult> {
    // 若已有工程打开，先按正常流程关掉（包括落盘 + 释放锁）
    if (this.currentPath && this.currentPath !== dir) {
      await this.close()
    } else if (this.currentPath === dir) {
      // 已经是当前工程，直接返回当前内容（重复点击最近工程时会走这里）
      return {
        ok: true,
        bundle: await this.buildBundle(dir)
      }
    }

    const lockResult = await acquireLock(dir)
    if (!lockResult.ok) {
      return { ok: false, reason: 'busy', heldByPid: lockResult.heldBy.pid }
    }

    try {
      const bundle = await this.buildBundle(dir)
      this.currentPath = dir
      this.touchRecentProjects(dir)
      return { ok: true, bundle }
    } catch (err) {
      // 加载失败要回滚锁，避免留下「没人用但也打不开」的僵尸锁
      await releaseLock(dir)
      if (err instanceof ProjectFileError) {
        return { ok: false, reason: 'invalid', message: err.message }
      }
      return { ok: false, reason: 'invalid', message: (err as Error).message }
    }
  }

  /**
   * 新建工程：在空目录里写骨架 + 打开。
   * 调用方（IPC handler）负责通过系统对话框拿到目录，并保证目录是空的。
   */
  async createNew(dir: string): Promise<OpenResult> {
    if (this.currentPath && this.currentPath !== dir) {
      await this.close()
    }

    const prefs = preferencesStore.snapshot
    const defaults = prefs.projectDefaults ?? { sampleRate: 48000, channels: 1 as 1 | 2 }
    const project = makeNewProjectFile({
      id: randomUUID(),
      title: basename(dir),
      sampleRate: defaults.sampleRate ?? 48000,
      channels: defaults.channels ?? 1
    })

    const lockResult = await acquireLock(dir)
    if (!lockResult.ok) {
      return { ok: false, reason: 'busy', heldByPid: lockResult.heldBy.pid }
    }

    try {
      await writeProjectSkeleton(dir, project)
      const bundle = await this.buildBundle(dir)
      this.currentPath = dir
      this.touchRecentProjects(dir)
      return { ok: true, bundle }
    } catch (err) {
      await releaseLock(dir)
      return { ok: false, reason: 'invalid', message: (err as Error).message }
    }
  }

  async close(): Promise<void> {
    if (!this.currentPath) return
    const dir = this.currentPath

    // 先把 pending 的 workspace 写入完成，避免丢失最后一次滚动 / 选中状态
    await this.flushWorkspace()

    await releaseLock(dir)
    this.currentPath = null
  }

  /**
   * renderer 端每次更新工作区状态（选中 / 滚动 / 缩放）都通过这里发起保存。
   * debounce 是为了把用户连续滚动或连点产生的多次 patch 合并成一次落盘。
   */
  scheduleWorkspaceSave(next: WorkspaceFile): void {
    if (!this.currentPath) return
    this.pendingWorkspace = next
    if (this.workspaceSaveTimer) clearTimeout(this.workspaceSaveTimer)
    this.workspaceSaveTimer = setTimeout(() => {
      this.workspaceSaveTimer = null
      void this.flushWorkspace()
    }, WORKSPACE_SAVE_DEBOUNCE_MS)
  }

  /**
   * 保存 segments.json。
   *
   * segments.json 属于工程内容，每次变更都要立即落盘——不做 debounce，
   * 避免用户编辑文本 / 重排 / 新增 Take 后立即崩溃导致数据丢失。
   * renderer 侧如果短时间内多次触发（例如连续打字），可以自行在 editorStore
   * 中做 debounce；到达这里的每一次调用都会直接原子写入。
   *
   * 返回 Promise 以便调用方（IPC handler）能把成功 / 失败反馈给 renderer。
   */
  async saveSegments(file: SegmentsFile): Promise<void> {
    if (!this.currentPath) {
      throw new Error('没有活动工程，无法保存 segments.json')
    }
    await saveSegmentsFile(this.currentPath, file)
  }

  async flushWorkspace(): Promise<void> {
    if (this.workspaceSaveTimer) {
      clearTimeout(this.workspaceSaveTimer)
      this.workspaceSaveTimer = null
    }
    if (!this.currentPath || !this.pendingWorkspace) return
    try {
      await saveWorkspaceFile(this.currentPath, this.pendingWorkspace)
      this.pendingWorkspace = null
    } catch (err) {
      console.error('[project-storage] workspace save failed:', err)
    }
  }

  private async buildBundle(dir: string): Promise<ProjectBundle> {
    const [projectFile, segments, workspace] = await Promise.all([
      loadProjectFile(dir),
      loadSegmentsFile(dir),
      loadWorkspaceFile(dir)
    ])
    // ProjectFile 和内存模型 Project 只差一个 schemaVersion 字段；
    // 送给 renderer 时不带版本信息（版本只在持久化层有意义）。
    const project = {
      id: projectFile.id,
      title: projectFile.title,
      createdAt: projectFile.createdAt,
      updatedAt: projectFile.updatedAt,
      audio: projectFile.audio,
      paths: projectFile.paths,
      exportDefaults: projectFile.exportDefaults
    }
    return { path: dir, project, segments, workspace }
  }

  /**
   * 把工程目录提升到 recentProjects 列表首位，并截断长度。
   * 这里直接调用 preferencesStore.update，让偏好模块自己处理写盘和广播。
   */
  private touchRecentProjects(dir: string): void {
    const current = preferencesStore.snapshot.recentProjects ?? []
    // 先去重（不同路径分隔符 / 尾部斜杠的情况可以在 Slice C 时统一规范化，这里先按字面比较）
    const next = [dir, ...current.filter((p) => p !== dir)].slice(0, MAX_RECENT_PROJECTS)
    preferencesStore.update({ recentProjects: next })
  }
}

export const projectSession = new ProjectSession()
