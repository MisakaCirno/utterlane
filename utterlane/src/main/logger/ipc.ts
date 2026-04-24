import { ipcMain } from 'electron'
import { openLogsFolder } from './index'

export const LOGS_IPC = {
  openFolder: 'logs:open-folder'
} as const

export function registerLogsIpc(): void {
  // 返回值用 null 表示成功，字符串表示失败原因——renderer 可以拿来做 toast
  ipcMain.handle(LOGS_IPC.openFolder, async () => {
    return openLogsFolder()
  })
}
