import type { DockviewApi } from 'dockview-react'
import i18n from '@renderer/i18n'
import { usePreferencesStore } from '@renderer/store/preferencesStore'

/**
 * Panel id ↔ i18n 标题键。Dockview 把 tab 标题作为字符串持久化进
 * preferences.layout.dockLayout——切换语言后旧标题不会自动更新。
 *
 * 策略：所有 panel 的 title 在创建时用 t() 写出当前语言；语言切换时
 * Workspace 监听 i18n 'languageChanged' 事件，遍历这张表回写新标题
 */
export const PANEL_TITLE_KEYS: Record<string, string> = {
  segments: 'panel.segments',
  inspector: 'panel.inspector',
  projectSettings: 'panel.project_settings',
  segmentTimeline: 'panel.segment_timeline',
  projectTimeline: 'panel.project_timeline',
  levelMeter: 'panel.level_meter'
}

/**
 * 显示菜单 toggle 的 panel 顺序 + 「再添加回来时去哪里」的默认位置。
 *
 * direction === undefined 表示并入参考 panel 的 group（同一 tab 组）。
 * 如果参考 panel 当下不在 layout 里，addPanel 会回退到无 position
 * （dockview 把它放进活动 group 或新建一个）——比抛错好，至少 panel
 * 出现在屏幕上让用户能看见
 */
type PanelDefinition = {
  component: string
  refId?: string
  direction?: 'left' | 'right' | 'above' | 'below' | 'within'
}

export const PANEL_DEFINITIONS: Record<string, PanelDefinition> = {
  segments: { component: 'segments' },
  inspector: { component: 'inspector', refId: 'segments', direction: 'right' },
  projectSettings: { component: 'projectSettings', refId: 'inspector', direction: 'within' },
  segmentTimeline: { component: 'segmentTimeline', refId: 'segments', direction: 'below' },
  projectTimeline: { component: 'projectTimeline', refId: 'segmentTimeline', direction: 'below' },
  levelMeter: { component: 'levelMeter', refId: 'segmentTimeline', direction: 'right' }
}

/** 菜单中 panel toggle 的展示顺序——按用户习惯的「读取优先」从上到下 */
export const PANEL_TOGGLE_ORDER: string[] = [
  'segments',
  'inspector',
  'projectSettings',
  'segmentTimeline',
  'projectTimeline',
  'levelMeter'
]

/**
 * 用当前语言把所有已知 panel 的 tab 标题刷一遍。
 * 用在两个地方：
 *   1. 从持久化布局 fromJSON 恢复后（旧语言的标题会被覆盖）
 *   2. i18n.languageChanged 事件触发时
 */
export function syncDockTabTitles(api: DockviewApi): void {
  const t = i18n.t.bind(i18n)
  for (const [panelId, key] of Object.entries(PANEL_TITLE_KEYS)) {
    const panel = api.getPanel(panelId)
    if (panel) panel.api.setTitle(t(key))
  }
}

/** 通过模块作用域的 currentApi 刷新标题，不存在 api 时 no-op */
export function refreshDockTabTitles(): void {
  if (currentApi) syncDockTabTitles(currentApi)
}

/**
 * 切换 panel 的可见性。当前存在则 removePanel，否则按 PANEL_DEFINITIONS
 * 的默认位置 addPanel 回去。
 *
 * 重新添加时若参考 panel 不在 layout 里（用户已经把它也关了），回退到
 * 无 position：dockview 把新 panel 放进活动 group / 新建一个，行为可
 * 预测且不抛错
 */
export function togglePanel(id: string): void {
  if (!currentApi) return
  const existing = currentApi.getPanel(id)
  if (existing) {
    currentApi.removePanel(existing)
    return
  }
  const def = PANEL_DEFINITIONS[id]
  if (!def) return
  const t = i18n.t.bind(i18n)
  const titleKey = PANEL_TITLE_KEYS[id]
  const refExists = def.refId ? !!currentApi.getPanel(def.refId) : false
  currentApi.addPanel({
    id,
    component: def.component,
    title: titleKey ? t(titleKey) : id,
    position:
      refExists && def.refId ? { referencePanel: def.refId, direction: def.direction } : undefined
  })
}

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
 *   │              │ [Inspector] [Settings] │
 *   │   Segments   │                        │
 *   │              │                        │
 *   ├──────────────┴────────────────────────┼─────────────┐
 *   │          Segment Timeline             │             │
 *   ├───────────────────────────────────────┤ Level Meter │
 *   │          Project Timeline             │             │
 *   └───────────────────────────────────────┴─────────────┘
 *
 * 构建顺序（含右侧电平条跨两个 Timeline 行的要点）：
 *   1. Segments 占满
 *   2. Segment Timeline below Segments → 上下分成两行
 *   3. Level Meter right of Segment Timeline → 此时下行水平分 [segmentTimeline | levelMeter]
 *   4. Project Timeline below Segment Timeline → 只切下行左列，levelMeter 自动跨新产生的两个子行
 *   5. Inspector right of Segments → 切最上行，projectSettings 并入 inspector group tab
 */
export function applyDefaultLayout(api: DockviewApi): void {
  // 标题从 i18n 取，跟用户当前语言一致；语言切换由 Workspace 的副作用
  // 调 syncDockTabTitles 维护
  const title = (id: string): string => i18n.t(PANEL_TITLE_KEYS[id])

  const segments = api.addPanel({
    id: 'segments',
    component: 'segments',
    title: title('segments')
  })

  const segmentTimeline = api.addPanel({
    id: 'segmentTimeline',
    component: 'segmentTimeline',
    title: title('segmentTimeline'),
    position: { referencePanel: segments.id, direction: 'below' }
  })

  // 必须在 projectTimeline 之前加 levelMeter，这样右侧才会横跨两个 timeline 的总高度。
  // 顺序反过来的话 levelMeter 只会贴 projectTimeline 的高度。
  api.addPanel({
    id: 'levelMeter',
    component: 'levelMeter',
    title: title('levelMeter'),
    position: { referencePanel: segmentTimeline.id, direction: 'right' }
  })

  const projectTimeline = api.addPanel({
    id: 'projectTimeline',
    component: 'projectTimeline',
    title: title('projectTimeline'),
    position: { referencePanel: segmentTimeline.id, direction: 'below' }
  })

  // 默认把两个 Timeline 的 tab 放到左侧——它们的工具栏内容横向密集，
  // 顶部 tab 占用的横向空间在窄面板下不划算；侧边 tab 让纵向稍占一点
  // 换出更多横向。用户可以拖回顶部 / 底部 / 右侧改变这个偏好
  segmentTimeline.group?.api.setHeaderPosition('left')
  projectTimeline.group?.api.setHeaderPosition('left')

  const inspector = api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: title('inspector'),
    position: { referencePanel: segments.id, direction: 'right' }
  })

  api.addPanel({
    id: 'projectSettings',
    component: 'projectSettings',
    title: title('projectSettings'),
    position: { referencePanel: inspector.id },
    inactive: true
  })

  // 初始尺寸：
  //   - 顶部行（Segments + Inspector）占总高 ~45%
  //   - Segment Timeline ~25%
  //   - Project Timeline ~30%（剩余高度）
  //   - Segments 组水平占 ~55%
  //   - Level Meter 组宽度约 80px
  requestAnimationFrame(() => {
    const width = api.width
    const height = api.height
    const segmentsPanel = api.getPanel('segments')
    const segmentTimelinePanel = api.getPanel('segmentTimeline')
    const levelMeterPanel = api.getPanel('levelMeter')

    if (width > 0 && segmentsPanel?.group) {
      segmentsPanel.group.api.setSize({ width: Math.round(width * 0.55) })
    }
    if (height > 0) {
      if (segmentsPanel?.group) {
        segmentsPanel.group.api.setSize({ height: Math.round(height * 0.45) })
      }
      if (segmentTimelinePanel?.group) {
        segmentTimelinePanel.group.api.setSize({ height: Math.round(height * 0.25) })
      }
    }
    if (levelMeterPanel?.group) {
      levelMeterPanel.group.api.setSize({ width: 100 })
    }
  })
}
