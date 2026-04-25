import { ipcMain } from 'electron'
import { LOGS_IPC } from '@shared/ipc'
import { openLogsFolder } from './index'

export { LOGS_IPC }

export function registerLogsIpc(): void {
  // 返回值用 null 表示成功，字符串表示失败原因——renderer 可以拿来做 toast
  ipcMain.handle(LOGS_IPC.openFolder, async () => {
    return openLogsFolder()
  })
}
