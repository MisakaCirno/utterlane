import { create } from 'zustand'
import { DEFAULT_PREFERENCES, type AppPreferences } from '@shared/preferences'

/**
 * 偏好在 renderer 侧的镜像。
 *
 * 数据流向：
 *   1. main 是权威副本（持有内存快照 + 负责写盘）
 *   2. renderer 启动时通过 api.preferences.get() 拉取一次，之后订阅 onChange 保持同步
 *   3. renderer 发起的更改经 api.preferences.update() 送到 main，
 *      main 合并后会广播回来，renderer 在 onChange 回调里更新自己的 store
 *
 * 这样所有窗口（即便未来有多个）看到的偏好是一致的，
 * 而 renderer 自己不需要实现任何持久化逻辑。
 */
type PreferencesState = {
  /** 当前偏好快照 */
  prefs: AppPreferences
  /** 是否已完成与 main 的首次 hydration。UI 在未 hydrated 时应显示 loading 或使用默认值 */
  hydrated: boolean

  /** 替换整个快照（仅由 hydration 和 onChange 回调调用） */
  replace: (prefs: AppPreferences) => void

  /**
   * 发送 patch 到 main 侧。返回之后界面不会立刻反映变更，
   * 需等 main 广播回来才会更新 store —— 这样保证本地状态永远和权威副本一致。
   */
  update: (patch: Partial<AppPreferences>) => void
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  prefs: DEFAULT_PREFERENCES,
  hydrated: false,

  replace: (prefs) => set({ prefs, hydrated: true }),
  update: (patch) => window.api.preferences.update(patch)
}))

/**
 * 在 App 挂载早期调用。完成 hydration 并订阅后续变更。
 * 返回一个 cleanup 函数，用于组件卸载时取消订阅（避免开发热重载时事件监听器泄漏）。
 */
export async function connectPreferencesStore(): Promise<() => void> {
  const initial = await window.api.preferences.get()
  usePreferencesStore.getState().replace(initial)
  return window.api.preferences.onChange((prefs) => {
    usePreferencesStore.getState().replace(prefs)
  })
}
