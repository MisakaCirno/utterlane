import { app, ipcMain } from 'electron'
import type { AppInfo } from '@shared/appInfo'

/**
 * 暴露给 renderer 的应用 / 运行时元信息。
 * About 对话框、bug 报告诊断都靠这一份数据。
 *
 * 全是只读、启动后不变，所以 renderer 端可以缓存 —— 我们直接同步算好返回。
 */

export const APP_INFO_IPC = {
  getInfo: 'app:get-info'
} as const

export function registerAppInfoIpc(): void {
  ipcMain.handle(APP_INFO_IPC.getInfo, (): AppInfo => {
    return {
      name: app.getName(),
      version: app.getVersion(),
      // 注意：app.getName / getVersion 都从 packaged 后的 package.json 取；
      // 但 homepage 不被 Electron 包进去，需要走 process.versions 之外的途径。
      // 简单起见这里硬留空，由 renderer 决定是否展示链接。
      homepage: '',
      electron: process.versions.electron ?? '',
      chromium: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      v8: process.versions.v8 ?? '',
      platform: process.platform,
      arch: process.arch
    }
  })
}
