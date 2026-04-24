import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { SegmentsView } from '@renderer/views/SegmentsView'
import { InspectorView } from '@renderer/views/InspectorView'
import { ProjectSettingsView } from '@renderer/views/ProjectSettingsView'
import { TimelineView } from '@renderer/views/TimelineView'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { DEFAULT_PREFERENCES } from '@shared/preferences'
import { getThemeByKey } from './themes'

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  segments: () => <SegmentsView />,
  inspector: () => <InspectorView />,
  projectSettings: () => <ProjectSettingsView />,
  timeline: () => <TimelineView />
}

function applyDefaultLayout(event: DockviewReadyEvent): void {
  const api = event.api

  // 目标布局：
  //   ┌──────────────┬────────────────────────┐
  //   │   Segments   │  Inspector / Settings  │
  //   ├──────────────┴────────────────────────┤
  //   │              Timeline                 │
  //   └───────────────────────────────────────┘
  //
  // 先拆上下两行（timeline below segments），再在上行右侧插入 inspector，
  // 最后把 projectSettings tab 并入 inspector 所在 group。
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
        onReady={applyDefaultLayout}
        disableFloatingGroups
        disableDnd={false}
      />
    </div>
  )
}
