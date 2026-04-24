import { ipcMain } from 'electron'
import type { AppPreferences } from '@shared/preferences'
import { preferencesStore } from './store'

/**
 * IPC 通道名。集中在这里定义，preload 侧直接引用同名常量，避免字面量散落。
 */
export const PREFERENCES_IPC = {
  get: 'preferences:get',
  update: 'preferences:update'
} as const

export function registerPreferencesIpc(): void {
  // 用 handle + invoke 是为了让 renderer 能拿到同步返回的当前快照。
  // renderer 启动时一般用它一次性获取初始值，之后靠订阅 PREFERENCES_CHANGED_EVENT 保持同步。
  ipcMain.handle(PREFERENCES_IPC.get, () => preferencesStore.snapshot)

  // update 是 fire-and-forget：renderer 不等待落盘结果，
  // 最终一致性由 broadcast 回推保证。
  ipcMain.on(PREFERENCES_IPC.update, (_, patch: Partial<AppPreferences>) => {
    preferencesStore.update(patch)
  })
}
