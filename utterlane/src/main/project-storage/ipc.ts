import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import {
  PROJECT_SCHEMA_VERSION,
  type Project,
  type ProjectFile,
  type SegmentsFile,
  type WorkspaceFile
} from '@shared/project'
import { PROJECT_IPC } from '@shared/ipc'
import { projectSession, type OpenResult } from './session'
import { projectPaths, resolveProjectRelative } from './paths'

export { PROJECT_IPC }

/** saveSegments 的 IPC 返回值；renderer 侧据此切换 saved 标记。 */
export type SaveSegmentsResult = { ok: true } | { ok: false; message: string }

/** saveProject 的返回值，和 saveSegments 同结构。失败的细节让 UI 弹错误 */
export type SaveProjectResult = { ok: true } | { ok: false; message: string }

async function isDirEmpty(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir)
    // 系统有时会放 .DS_Store / Thumbs.db，不算真正的内容
    return entries.every((name) => name.startsWith('.'))
  } catch {
    return false
  }
}

export function registerProjectIpc(): void {
  /**
   * 新建工程：弹系统目录选择对话框，要求目录为空，然后写骨架并打开。
   */
  ipcMain.handle(PROJECT_IPC.new, async (event): Promise<OpenResult> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) return { ok: false, reason: 'invalid', message: '找不到窗口' }

    const result = await dialog.showOpenDialog(parent, {
      title: '选择新工程目录',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
      buttonLabel: '新建工程'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'invalid', message: '已取消', canceled: true }
    }
    const dir = result.filePaths[0]

    if (!(await isDirEmpty(dir))) {
      return {
        ok: false,
        reason: 'invalid',
        message: '目录非空。请选择一个空目录来新建工程。'
      }
    }

    return projectSession.createNew(dir)
  })

  /**
   * 打开工程：弹目录对话框，选定后交给 session 处理（含锁 + 校验）。
   */
  ipcMain.handle(PROJECT_IPC.open, async (event): Promise<OpenResult> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) return { ok: false, reason: 'invalid', message: '找不到窗口' }

    const result = await dialog.showOpenDialog(parent, {
      title: '选择工程目录',
      properties: ['openDirectory'],
      buttonLabel: '打开'
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, reason: 'invalid', message: '已取消', canceled: true }
    }
    return projectSession.open(result.filePaths[0])
  })

  /**
   * 按给定绝对路径打开（用于点击「最近工程」条目，绕过对话框）。
   */
  ipcMain.handle(PROJECT_IPC.openPath, async (_e, path: string): Promise<OpenResult> => {
    // 先做一次存在性检查，避免把损坏的 recent 路径扔到 session 里再报错
    try {
      const stat = await fs.stat(projectPaths(path).projectFile)
      if (!stat.isFile()) throw new Error('project.json 不是文件')
    } catch (err) {
      return {
        ok: false,
        reason: 'invalid',
        message: `工程路径失效：${(err as Error).message}`
      }
    }
    return projectSession.open(path)
  })

  ipcMain.handle(PROJECT_IPC.close, async () => {
    await projectSession.close()
  })

  ipcMain.handle(PROJECT_IPC.current, () => projectSession.path)

  /**
   * workspace 保存：fire-and-forget，main 侧 debounce。
   * renderer 不等写盘完成。
   */
  ipcMain.on(PROJECT_IPC.saveWorkspace, (_e, next: WorkspaceFile) => {
    projectSession.scheduleWorkspaceSave(next)
  })

  /**
   * segments.json 保存：立即原子写。renderer 等 result 回来后更新 saved 标记。
   * 任何写入失败都返回 message 给 renderer，让用户有明确反馈——
   * 工程内容丢失风险最高，宁可让用户看到错误，也不静默。
   */
  ipcMain.handle(
    PROJECT_IPC.saveSegments,
    async (_e, next: SegmentsFile): Promise<SaveSegmentsResult> => {
      try {
        await projectSession.saveSegments(next)
        return { ok: true }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  /**
   * 保存 project.json。renderer 传完整的 Project（不含 schemaVersion），
   * main 包上当前 PROJECT_SCHEMA_VERSION 后原子写入。
   *
   * 和 saveSegments 一样立即落盘——project meta 改动频率低（用户编辑设置
   * 才会触发），每次都直接写不会成为性能瓶颈。
   *
   * updatedAt 由 renderer 侧 updateProject 在 patch 应用时一并写入，
   * 这里不再覆盖：保证 main 写入磁盘的值与 editorStore 内存里的 Project
   * 一致，避免「内存看到的 updatedAt 是上次 open 的值，磁盘是当前时间」
   * 这种隐性发散
   */
  ipcMain.handle(PROJECT_IPC.saveProject, async (_e, next: Project): Promise<SaveProjectResult> => {
    try {
      const file: ProjectFile = {
        ...next,
        schemaVersion: PROJECT_SCHEMA_VERSION
      }
      await projectSession.saveProject(file)
      return { ok: true }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  })

  /**
   * 读取工程内的 Take 文件给 renderer 播放。
   *
   * 安全性：renderer 传来的 relativePath 必须是工程目录下的相对路径，
   * 不能通过 ../../ 越界读别的磁盘位置。用 path.relative 做正规化 + 边界校验。
   *
   * 大文件：当前返回整份 ArrayBuffer。对于几秒的人声片段 100KB~几 MB，
   * IPC 完全 OK。若将来要播放几十分钟的连读，应改成流式 / 注册自定义协议。
   */
  ipcMain.handle(
    PROJECT_IPC.readTakeFile,
    async (_e, relativePath: string): Promise<ArrayBuffer> => {
      const projectDir = projectSession.path
      if (!projectDir) throw new Error('没有活动工程')
      const absolute = resolveProjectRelative(projectDir, relativePath)
      const buf = await fs.readFile(absolute)
      // Node 的 Buffer 底层是 ArrayBuffer 共享池；拷贝一份纯净 ArrayBuffer 避免 IPC 上的生命周期问题
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    }
  )
}
