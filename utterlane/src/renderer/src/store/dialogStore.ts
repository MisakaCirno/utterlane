import { create } from 'zustand'

/**
 * 对话框的开关集中管理。
 *
 * 为什么不把状态放在 App 组件里：
 *   菜单（Titlebar 里）和对话框（App 里）相隔较远，中间传 prop 不划算；
 *   命令式触发（比如菜单项的 onSelect）也不方便走 React 上下文。
 *   用一个极小的 Zustand store 让任意组件都能 open(...) / close(...)。
 *
 * 新增对话框时只需加一个布尔 key 和对应的 open / close action。
 */
type DialogState = {
  importScriptOpen: boolean
  openImportScript: () => void
  closeImportScript: () => void

  preferencesOpen: boolean
  openPreferences: () => void
  closePreferences: () => void
}

export const useDialogStore = create<DialogState>((set) => ({
  importScriptOpen: false,
  openImportScript: () => set({ importScriptOpen: true }),
  closeImportScript: () => set({ importScriptOpen: false }),

  preferencesOpen: false,
  openPreferences: () => set({ preferencesOpen: true }),
  closePreferences: () => set({ preferencesOpen: false })
}))
