import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { AppPreferences } from '@shared/preferences'

// IPC 通道名需要和 main 侧保持一致。
// 这里复制字面量而不是 import 主进程的常量，是因为 preload 打包时
// 会把依赖的 main 侧代码也带进来，风险太大；preload 只应依赖 @shared。
const PREFERENCES_GET = 'preferences:get'
const PREFERENCES_UPDATE = 'preferences:update'
const PREFERENCES_CHANGED = 'preferences:changed'

const api = {
  window: {
    minimize: (): void => ipcRenderer.send('window:minimize'),
    toggleMaximize: (): void => ipcRenderer.send('window:toggle-maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeStateChange: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on('window:maximize-state', listener)
      return () => ipcRenderer.removeListener('window:maximize-state', listener)
    }
  },

  preferences: {
    /** 获取当前偏好快照。renderer 启动时调用一次用于 hydration。 */
    get: (): Promise<AppPreferences> => ipcRenderer.invoke(PREFERENCES_GET),

    /**
     * 发送 partial patch。main 侧会合并 + debounce 写盘 + 广播变更。
     * fire-and-forget：renderer 拿到的最终值通过 onChange 回推。
     */
    update: (patch: Partial<AppPreferences>): void => ipcRenderer.send(PREFERENCES_UPDATE, patch),

    /**
     * 订阅偏好变更事件。用于 renderer 端保持本地副本与 main 同步
     * （包括自己发起的 update 被 merge 之后的完整状态）。
     * 返回一个 unsubscribe 函数，组件卸载时调用以避免泄露。
     */
    onChange: (cb: (prefs: AppPreferences) => void): (() => void) => {
      const listener = (_: unknown, prefs: AppPreferences): void => cb(prefs)
      ipcRenderer.on(PREFERENCES_CHANGED, listener)
      return () => ipcRenderer.removeListener(PREFERENCES_CHANGED, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type UtterlaneApi = typeof api
