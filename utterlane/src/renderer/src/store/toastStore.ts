import { create } from 'zustand'

/**
 * 全局 toast 队列。
 *
 * 设计选择：
 *   - 纯粹的状态 store + 命令式 show()；UI 组件（ToastHost）订阅渲染
 *   - 非组件调用方（比如 actions/* 里的错误反馈）不需要拿到 React context，
 *     直接 import showToast 即可
 *   - 同时展示多条（Radix Toast 支持），用 id 区分；autoDismissMs 控制单条生命周期
 */

export type ToastKind = 'info' | 'success' | 'error'

export type Toast = {
  id: string
  kind: ToastKind
  title: string
  description?: string
}

type ToastState = {
  toasts: Toast[]
  show: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (t) =>
    set((s) => ({
      toasts: [...s.toasts, { ...t, id: crypto.randomUUID() }]
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/**
 * 提供给非组件代码的快捷入口。
 * actions / store 里出现错误时调这些函数，不用知道 toastStore 的结构。
 */
export function showError(title: string, description?: string): void {
  useToastStore.getState().show({ kind: 'error', title, description })
}

export function showSuccess(title: string, description?: string): void {
  useToastStore.getState().show({ kind: 'success', title, description })
}

export function showInfo(title: string, description?: string): void {
  useToastStore.getState().show({ kind: 'info', title, description })
}
