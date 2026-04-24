import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as ContextMenu from '@radix-ui/react-context-menu'
import { Check } from 'lucide-react'
import { DockviewDefaultTab, type IDockviewPanelHeaderProps } from 'dockview-react'
import type { DockviewHeaderPosition } from 'dockview-core'
import { cn } from '@renderer/lib/cn'

/**
 * 自定义 Tab 组件：在 dockview 默认 tab 外层套一个 Radix ContextMenu，
 * 支持右键切换当前 group 的 tab 栏位置（上 / 下 / 左 / 右）。
 *
 * dockview 把 tab 位置存储在 group.model.headerPosition，toJSON 会序列化，
 * 所以用户调整后会自动持久化到 preferences.layout.dockLayout。
 *
 * 通过 defaultTabComponent 注入，作用于所有 panel 的 tab。
 */

const POSITIONS: DockviewHeaderPosition[] = ['top', 'bottom', 'left', 'right']

export function DockTab(props: IDockviewPanelHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  // 用 state 镜像当前 header position，右键打开时读最新值。
  // dockview 没有 headerPositionChange 事件，我们在打开菜单时主动同步。
  const [position, setPosition] = useState<DockviewHeaderPosition>(() =>
    props.api.group.api.getHeaderPosition()
  )

  const syncPosition = useCallback(() => {
    setPosition(props.api.group.api.getHeaderPosition())
  }, [props.api])

  const setHeaderPosition = (next: DockviewHeaderPosition): void => {
    props.api.group.api.setHeaderPosition(next)
    setPosition(next)
  }

  return (
    <ContextMenu.Root onOpenChange={(open) => open && syncPosition()}>
      <ContextMenu.Trigger asChild>
        <div className="h-full w-full">
          <DockviewDefaultTab {...props} />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className="min-w-[180px] rounded-sm border border-border bg-bg-panel py-1 shadow-xl"
          // 让右键菜单不会被 dockview 的 drag handler 误触
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ContextMenu.Label className="px-3 py-1 text-2xs text-fg-dim">
            {t('tab_menu.header_position')}
          </ContextMenu.Label>
          <ContextMenu.RadioGroup
            value={position}
            onValueChange={(v) => setHeaderPosition(v as DockviewHeaderPosition)}
          >
            {POSITIONS.map((pos) => (
              <ContextMenu.RadioItem
                key={pos}
                value={pos}
                className={cn(
                  'relative flex cursor-default items-center gap-2 px-3 py-1.5 pl-6 text-xs outline-none',
                  'data-[highlighted]:bg-accent data-[highlighted]:text-white'
                )}
              >
                <ContextMenu.ItemIndicator className="absolute left-1.5">
                  <Check size={11} />
                </ContextMenu.ItemIndicator>
                {t(`tab_menu.position_${pos}`)}
              </ContextMenu.RadioItem>
            ))}
          </ContextMenu.RadioGroup>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
