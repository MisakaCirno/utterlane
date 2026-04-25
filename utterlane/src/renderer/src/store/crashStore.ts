import { create } from 'zustand'
import type { CrashInfo } from '@shared/crash'

/**
 * 崩溃信息的全局展示状态。
 *
 * 设计：
 *   - 同时只展示一条；新崩溃直接替换旧的
 *     （多个错误连环爆通常源于同一根因，看最新的就够；用户看完关掉就行）
 *   - dismiss 只关 UI，不影响应用本身的存活
 *   - 不主动重启 / 不主动关窗——交给用户决定
 */
type CrashState = {
  current: CrashInfo | null
  show: (info: CrashInfo) => void
  dismiss: () => void
}

export const useCrashStore = create<CrashState>((set) => ({
  current: null,
  show: (info) => set({ current: info }),
  dismiss: () => set({ current: null })
}))

/** 非组件代码的快捷入口 */
export function reportCrash(info: CrashInfo): void {
  useCrashStore.getState().show(info)
}
