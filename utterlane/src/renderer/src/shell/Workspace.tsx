import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { SegmentsView } from '@renderer/views/SegmentsView'
import { InspectorView } from '@renderer/views/InspectorView'
import { ProjectSettingsView } from '@renderer/views/ProjectSettingsView'
import { TimelineView } from '@renderer/views/TimelineView'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { DEFAULT_PREFERENCES } from '@shared/preferences'
import { getThemeByKey } from './themes'
import { applyDefaultLayout, setWorkspaceApi } from './workspaceHandle'

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  segments: () => <SegmentsView />,
  inspector: () => <InspectorView />,
  projectSettings: () => <ProjectSettingsView />,
  timeline: () => <TimelineView />
}

/**
 * onReady 流程：
 *   1. 登记 api 到模块句柄，菜单等命令式入口可以通过它触发 Reset Layout
 *   2. 有持久化布局就 fromJSON，否则应用默认布局
 *   3. 订阅 onDidLayoutChange → 把最新 toJSON 快照写回 preferences.layout.dockLayout
 *
 * 持久化由 preferencesStore 主侧 debounce，renderer 侧无需再限流。
 */
function onWorkspaceReady(event: DockviewReadyEvent): void {
  const api = event.api
  setWorkspaceApi(api)

  const saved = usePreferencesStore.getState().prefs.layout?.dockLayout
  if (saved) {
    try {
      api.fromJSON(saved as never)
    } catch (err) {
      // 持久化布局和当前版本不兼容（比如组件 id 变了 / 结构 schema 变了）时，
      // 不让整个 workspace 卡住——静默回落到默认布局。
      console.warn('[workspace] fromJSON failed, falling back to default layout:', err)
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
        onReady={onWorkspaceReady}
        disableFloatingGroups
        disableDnd={false}
      />
    </div>
  )
}
