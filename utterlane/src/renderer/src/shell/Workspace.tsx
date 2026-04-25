import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react'
import { SegmentsView } from '@renderer/views/SegmentsView'
import { InspectorView } from '@renderer/views/InspectorView'
import { ProjectSettingsView } from '@renderer/views/ProjectSettingsView'
import { SegmentTimelineView } from '@renderer/views/SegmentTimelineView'
import { ProjectTimelineView } from '@renderer/views/ProjectTimelineView'
import { LevelMeterView } from '@renderer/views/LevelMeterView'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import {
  DEFAULT_PREFERENCES,
  DOCK_LAYOUT_SCHEMA_VERSION,
  type DockLayoutEnvelope
} from '@shared/preferences'
import { getThemeByKey } from './themes'
import { applyDefaultLayout, setWorkspaceApi } from './workspaceHandle'
import { DockTab } from './DockTab'
import { devWarn } from '@renderer/lib/devLog'

/**
 * 所有 panel 内容的统一外壳：强制尺寸严格等于 dockview panel content
 * container，不被内部「max-content 宽度」的子项撑出。
 *
 * 背景：dockview 的 panel content container 通常用 absolute 定位 + 显式
 * 尺寸控制 panel 可见区。在 absolute 父级里，普通 block / flex 元素的
 * `width: auto` 行为是 **shrink-to-fit = max-content**，而不是 stretch
 * 占满父级。如果面板内部有 `min-w-max` 之类的 max-content 子项（比如
 * ProjectTimeline 的 toolbar、SegmentsView 的 grid 列宽），整个 view
 * root 会被撑成超过 panel 可见宽度，导致：
 *   - 超出部分被 dockview 裁掉，按钮 / 内容看不见
 *   - 内层 scroll 容器拿到的 clientWidth 是过宽尺寸，scrollbar 长度
 *     大于 panel 可见宽度
 *
 * w-full + h-full 强制 stretch；overflow-hidden 兜底防 view 自身溢出；
 * min-w-0 让 view root 在 PanelShell 的 flex 上下文里能收缩。view 自己
 * 不需要再操心这层约束
 */
function PanelShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full w-full min-w-0 flex-col overflow-hidden">{children}</div>
}

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  segments: () => (
    <PanelShell>
      <SegmentsView />
    </PanelShell>
  ),
  inspector: () => (
    <PanelShell>
      <InspectorView />
    </PanelShell>
  ),
  projectSettings: () => (
    <PanelShell>
      <ProjectSettingsView />
    </PanelShell>
  ),
  segmentTimeline: () => (
    <PanelShell>
      <SegmentTimelineView />
    </PanelShell>
  ),
  projectTimeline: () => (
    <PanelShell>
      <ProjectTimelineView />
    </PanelShell>
  ),
  levelMeter: () => (
    <PanelShell>
      <LevelMeterView />
    </PanelShell>
  )
}

/**
 * 检查 saved layout 是否仍然与当前 panel 集匹配。
 *
 * 判定规则：单纯比对 schemaVersion——dockview 自己不知道我们怎么定义
 * 「兼容」（panel id 改动、新增 / 删除 panel 都属于破坏性变化），所以
 * 由我们维护一个外层版本号。每次默认布局结构变就在 shared/preferences.ts
 * 里 +1，旧持久化数据自动作废。
 *
 * 旧版本（直接存 dockview 序列化原 JSON、没有信封）会因为 schemaVersion
 * 字段缺失被识别为 0，同样回落默认。
 */
function isLayoutCompatible(saved: DockLayoutEnvelope | undefined): boolean {
  if (!saved || typeof saved !== 'object') return false
  if (saved.schemaVersion !== DOCK_LAYOUT_SCHEMA_VERSION) return false
  if (!saved.layout || typeof saved.layout !== 'object') return false
  return true
}

/**
 * onReady 流程：
 *   1. 登记 api 到模块句柄，菜单等命令式入口可以通过它触发 Reset Layout
 *   2. 有持久化布局且兼容当前版本 → fromJSON；否则应用默认布局
 *   3. 订阅 onDidLayoutChange → 把最新 toJSON 快照 + schemaVersion 写回
 *      preferences.layout.dockLayout
 *
 * 持久化由 preferencesStore 主侧 debounce，renderer 侧无需再限流。
 */
function onWorkspaceReady(event: DockviewReadyEvent): void {
  const api = event.api
  setWorkspaceApi(api)

  const saved = usePreferencesStore.getState().prefs.layout?.dockLayout
  if (isLayoutCompatible(saved)) {
    try {
      api.fromJSON(saved!.layout as never)
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
    const envelope: DockLayoutEnvelope = {
      schemaVersion: DOCK_LAYOUT_SCHEMA_VERSION,
      layout: api.toJSON()
    }
    usePreferencesStore.getState().update({ layout: { dockLayout: envelope } })
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
