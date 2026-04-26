import { create } from 'zustand'

/**
 * Dock 视图的实时快照。
 *
 * 为什么独立成一个 store：
 *   Workspace 的 onReady 把 dockview api 收到模块作用域里给命令式入口
 *   （菜单 Reset Layout 等）使用，但 React 组件想知道「当前哪些 panel
 *   是打开的」就需要响应式订阅——既不属于 preferences（持久化），也不
 *   属于 editorStore（工程数据）。这里维护一份 openPanelIds 镜像，
 *   Workspace 监听 dockview 的 onDidAddPanel / onDidRemovePanel 事件
 *   保持同步，菜单组件 useDockStore 即可。
 */
type DockState = {
  /** 当前打开的 panel id 集合。空集 = 还没初始化或工程未打开 */
  openPanelIds: ReadonlySet<string>
  setOpenPanelIds: (ids: ReadonlySet<string>) => void
}

export const useDockStore = create<DockState>((set) => ({
  openPanelIds: new Set(),
  setOpenPanelIds: (ids) => set({ openPanelIds: ids })
}))
