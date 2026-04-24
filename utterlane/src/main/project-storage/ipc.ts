import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import type { SegmentsFile, WorkspaceFile } from '@shared/project'
import { projectSession, type OpenResult } from './session'
import { projectPaths } from './paths'

/**
 * 集中定义的 IPC 通道名。preload 复制同名字符串，避免跨进程 import 耦合。
 */
export const PROJECT_IPC = {
  new: 'project:new',
  open: 'project:open',
  openPath: 'project:open-path',
  close: 'project:close',
  current: 'project:current',
  saveWorkspace: 'project:save-workspace',
  saveSegments: 'project:save-segments'
} as const

/** saveSegments 的 IPC 返回值；renderer 侧据此切换 saved 标记。 */
export type SaveSegmentsResult = { ok: true } | { ok: false; message: string }

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
      return { ok: false, reason: 'invalid', message: '已取消' }
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
      return { ok: false, reason: 'invalid', message: '已取消' }
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
}
