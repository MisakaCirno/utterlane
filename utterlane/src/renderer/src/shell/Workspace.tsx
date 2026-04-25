import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { SegmentsView } from '@renderer/views/SegmentsView'
import { InspectorView } from '@renderer/views/InspectorView'
import { ProjectSettingsView } from '@renderer/views/ProjectSettingsView'
import { SegmentTimelineView } from '@renderer/views/SegmentTimelineView'
import { ProjectTimelineView } from '@renderer/views/ProjectTimelineView'
import { LevelMeterView } from '@renderer/views/LevelMeterView'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { DEFAULT_PREFERENCES } from '@shared/preferences'
import { getThemeByKey } from './themes'
import { applyDefaultLayout, setWorkspaceApi } from './workspaceHandle'
import { DockTab } from './DockTab'
import { devWarn } from '@renderer/lib/devLog'

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  segments: () => <SegmentsView />,
  inspector: () => <InspectorView />,
  projectSettings: () => <ProjectSettingsView />,
  segmentTimeline: () => <SegmentTimelineView />,
  projectTimeline: () => <ProjectTimelineView />,
  levelMeter: () => <LevelMeterView />
}

/**
 * 检查 saved layout 是否仍然与当前 panel 集匹配。
 * 不匹配直接返回 false，让上层丢弃 saved 回落到默认布局。
 *
 * 判定规则：
 *   - 出现历史遗留 ID（比如旧版的单一 `timeline` 面板）→ 不兼容
 *   - 缺任何当前必须的面板（新加面板例如 levelMeter 时触发） → 不兼容
 */
const REQUIRED_PANELS = [
  'segments',
  'inspector',
  'projectSettings',
  'segmentTimeline',
  'projectTimeline',
  'levelMeter'
] as const

function isLayoutCompatible(saved: unknown): boolean {
  if (!saved || typeof saved !== 'object') return false
  const panels = (saved as { panels?: Record<string, unknown> }).panels
  if (!panels) return false
  if ('timeline' in panels) return false
  for (const id of REQUIRED_PANELS) {
    if (!(id in panels)) return false
  }
  return true
}

/**
 * onReady 流程：
 *   1. 登记 api 到模块句柄，菜单等命令式入口可以通过它触发 Reset Layout
 *   2. 有持久化布局且兼容当前版本 → fromJSON；否则应用默认布局
 *   3. 订阅 onDidLayoutChange → 把最新 toJSON 快照写回 preferences.layout.dockLayout
 *
 * 持久化由 preferencesStore 主侧 debounce，renderer 侧无需再限流。
 */
function onWorkspaceReady(event: DockviewReadyEvent): void {
  const api = event.api
  setWorkspaceApi(api)

  const saved = usePreferencesStore.getState().prefs.layout?.dockLayout
  if (saved && isLayoutCompatible(saved)) {
    try {
      api.fromJSON(saved as never)
    } catch (err) {
      // 持久化布局解析失败：app 会回落到默认布局继续工作，属于诊断信息
      // 而非用户可见错误——只在 dev 模式下打印
      devWarn('[workspace] fromJSON failed, falling back to default layout:', err)
      api.clear()
      applyDefaultLayout(api)
    }
  } else {
    applyDefaultLayout(api)
  }

  api.onDidLayoutChange(() => {
    usePreferencesStore.getState().update({ layout: { dockLayout: api.toJSON() } })
  })
}

export function Workspace(): React.JSX.Element {
  // 未 hydrate 前用默认主题，避免首帧闪烁；hydrate 之后切换到用户选择的主题
  const themeKey = usePreferencesStore(
    (s) => s.prefs.appearance?.dockTheme ?? DEFAULT_PREFERENCES.appearance!.dockTheme!
  )
  const theme = getThemeByKey(themeKey)

  return (
    <div className="flex-1 overflow-hidden">
      <DockviewReact
        className="h-full"
        theme={theme}
        components={components}
        defaultTabComponent={DockTab}
        onReady={onWorkspaceReady}
        disableFloatingGroups
        disableDnd={false}
      />
    </div>
  )
}
