import type { DockviewApi } from 'dockview-react'
import { usePreferencesStore } from '@renderer/store/preferencesStore'

/**
 * Workspace 的命令式句柄。
 *
 * 为什么不把 DockviewApi 放进 Zustand store：
 *   api 不是 React 状态，没有「订阅 re-render」的诉求；
 *   菜单 / 快捷键等命令式入口只需要一个可达的 ref。
 *   用一个模块级 var 足够。
 *
 * 唯一的调用方是：
 *   - Workspace.tsx：挂载/卸载时调 setApi 登记 / 清空
 *   - 菜单 Reset Layout 之类：直接调 resetLayout()
 */

let currentApi: DockviewApi | null = null

export function setWorkspaceApi(api: DockviewApi | null): void {
  currentApi = api
}

/**
 * 清空当前所有 panel + 清掉持久化的布局 + 重新建默认布局。
 *
 * 把「清掉持久化」和「重建默认」分开：
 *   - 先置空 preferences.layout.dockLayout，避免重建过程中触发的
 *     onDidLayoutChange 又把旧布局回写进来造成回滚
 *   - 重建默认后 onDidLayoutChange 会自动把新默认作为最新持久化版本保存
 */
export function resetWorkspaceLayout(): void {
  if (!currentApi) return
  usePreferencesStore.getState().update({ layout: { dockLayout: undefined } })
  currentApi.clear()
  applyDefaultLayout(currentApi)
}

/**
 * 默认布局：
 *   ┌──────────────┬────────────────────────┐
 *   │   Segments   │ [Inspector] [Settings] │
 *   ├──────────────┴────────────────────────┤
 *   │              Timeline                 │
 *   └───────────────────────────────────────┘
 *
 * 实现顺序：先建 Segments → timeline below 它（此时 timeline 就占满下沿）
 * → inspector right of segments（只切上行）→ projectSettings 并入 inspector group 做 tab
 */
export function applyDefaultLayout(api: DockviewApi): void {
  const segments = api.addPanel({
    id: 'segments',
    component: 'segments',
    title: 'Segments'
  })

  api.addPanel({
    id: 'timeline',
    component: 'timeline',
    title: 'Timeline',
    position: { referencePanel: segments.id, direction: 'below' }
  })

  const inspector = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: 'Inspector',
    position: { referencePanel: segments.id, direction: 'right' }
  })

  api.addPanel({
    id: 'projectSettings',
    component: 'projectSettings',
    title: 'Project Settings',
    position: { referencePanel: inspector.id },
    inactive: true
  })

  // 初始尺寸：左 62% / 上 62%。等下一帧确定 api.width/height 后再设。
  requestAnimationFrame(() => {
    const width = api.width
    const height = api.height
    const segmentsPanel = api.getPanel('segments')
    const timelinePanel = api.getPanel('timeline')
    if (width > 0 && segmentsPanel?.group) {
      segmentsPanel.group.api.setSize({ width: Math.round(width * 0.62) })
    }
    if (height > 0 && timelinePanel?.group) {
      timelinePanel.group.api.setSize({ height: Math.round(height * 0.38) })
    }
  })
}
