import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Minus, Square, Copy, X, Mic } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { useHistoryStore } from '@renderer/store/historyStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { formatBinding, resolveBindings } from '@shared/preferences'
import { closeCurrentProject, newProject, openProject } from '@renderer/actions/project'
import { exportAudioWav, exportSubtitlesSrt } from '@renderer/actions/export'
import { useDialogStore } from '@renderer/store/dialogStore'
import { useDockStore } from '@renderer/store/dockStore'
import {
  PANEL_TITLE_KEYS,
  PANEL_TOGGLE_ORDER,
  resetWorkspaceLayout,
  togglePanel
} from './workspaceHandle'

type MenuItem =
  | { kind: 'item'; label: string; shortcut?: string; disabled?: boolean; onSelect?: () => void }
  | {
      kind: 'checkbox'
      label: string
      checked: boolean
      disabled?: boolean
      onSelect?: () => void
    }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: MenuItem[] }
  | {
      kind: 'radioGroup'
      value: string
      onValueChange: (value: string) => void
      options: Array<{ value: string; label: string }>
    }

type MenuDef = { label: string; items: MenuItem[] }

type HistoryMenuCtx = {
  canUndo: boolean
  canRedo: boolean
  /** 栈顶命令的 i18n key；null 表示栈空或播放中禁用 */
  undoLabelKey: string | null
  redoLabelKey: string | null
}

function buildMenus(
  t: TFunction,
  hasProject: boolean,
  openImportScript: () => void,
  openPreferences: () => void,
  openAbout: () => void,
  openAudioAudit: () => void,
  history: HistoryMenuCtx,
  transportShortcuts: {
    record: string
    rerecord: string
    playSegment: string
    playProject: string
    stop: string
  },
  openPanelIds: ReadonlySet<string>
): MenuDef[] {
  // undo / redo 动态标签：可用时显示「撤销：编辑文案」让用户知道会撤销什么；
  // 不可用时退回纯标签（也不显示 label 后缀，避免视觉上像可点击）
  const undoLabel =
    history.canUndo && history.undoLabelKey
      ? t('menu.edit_undo_labeled', { label: t(history.undoLabelKey) })
      : t('menu.edit_undo')
  const redoLabel =
    history.canRedo && history.redoLabelKey
      ? t('menu.edit_redo_labeled', { label: t(history.redoLabelKey) })
      : t('menu.edit_redo')
  return [
    {
      label: t('menu.file'),
      items: [
        { kind: 'item', label: t('menu.file_new'), shortcut: 'Ctrl+N', onSelect: newProject },
        { kind: 'item', label: t('menu.file_open'), shortcut: 'Ctrl+O', onSelect: openProject },
        {
          kind: 'item',
          label: t('menu.file_close'),
          disabled: !hasProject,
          onSelect: closeCurrentProject
        },
        { kind: 'separator' },
        { kind: 'item', label: t('menu.file_save'), shortcut: 'Ctrl+S', disabled: !hasProject },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('menu.file_import'),
          disabled: !hasProject,
          onSelect: openImportScript
        },
        {
          kind: 'submenu',
          label: t('menu.file_export'),
          items: [
            {
              kind: 'item',
              label: t('menu.file_export_wav'),
              disabled: !hasProject,
              onSelect: exportAudioWav
            },
            {
              kind: 'item',
              label: t('menu.file_export_srt'),
              disabled: !hasProject,
              onSelect: exportSubtitlesSrt
            }
          ]
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('menu.file_audit'),
          disabled: !hasProject,
          onSelect: openAudioAudit
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('menu.file_exit'),
          shortcut: 'Alt+F4',
          onSelect: () => window.api.window.close()
        }
      ]
    },
    {
      label: t('menu.edit'),
      items: [
        {
          kind: 'item',
          label: undoLabel,
          shortcut: 'Ctrl+Z',
          disabled: !history.canUndo,
          onSelect: () => useHistoryStore.getState().undo()
        },
        {
          kind: 'item',
          label: redoLabel,
          shortcut: 'Ctrl+Y',
          disabled: !history.canRedo,
          onSelect: () => useHistoryStore.getState().redo()
        },
        { kind: 'separator' },
        { kind: 'item', label: t('menu.edit_delete'), shortcut: 'Delete' },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('preferences.menu_entry'),
          shortcut: 'Ctrl+,',
          onSelect: openPreferences
        }
      ]
    },
    {
      label: t('menu.view'),
      items: [
        {
          kind: 'item',
          label: t('menu.view_reset_layout'),
          disabled: !hasProject,
          onSelect: resetWorkspaceLayout
        },
        { kind: 'separator' },
        // 6 个 panel 的显示 / 隐藏。checkbox 反映当前是否打开；点击切换。
        // 工程未打开时整列 disabled——dockview 容器没工作内容
        ...PANEL_TOGGLE_ORDER.map<MenuItem>((id) => ({
          kind: 'checkbox',
          label: t(PANEL_TITLE_KEYS[id]),
          checked: openPanelIds.has(id),
          disabled: !hasProject,
          onSelect: () => togglePanel(id)
        }))
        // Dock 主题已经整合到 Edit → Preferences 里；
        // 保留 View 菜单的「布局」概念，主题由统一偏好管理
      ]
    },
    {
      label: t('menu.transport'),
      items: [
        { kind: 'item', label: t('menu.transport_record'), shortcut: transportShortcuts.record },
        {
          kind: 'item',
          label: t('menu.transport_rerecord'),
          shortcut: transportShortcuts.rerecord
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('menu.transport_play_segment'),
          shortcut: transportShortcuts.playSegment
        },
        {
          kind: 'item',
          label: t('menu.transport_play_project'),
          shortcut: transportShortcuts.playProject
        },
        { kind: 'item', label: t('menu.transport_stop'), shortcut: transportShortcuts.stop }
      ]
    },
    {
      label: t('menu.help'),
      items: [
        { kind: 'item', label: t('menu.help_about'), onSelect: openAbout },
        { kind: 'item', label: t('menu.help_license') },
        { kind: 'item', label: t('menu.help_homepage') },
        { kind: 'separator' },
        {
          kind: 'item',
          label: t('menu.help_open_logs'),
          onSelect: () => void window.api.logs.openFolder()
        }
      ]
    },
    // Dev 菜单：仅 import.meta.env.DEV 为 true 时挂载（开发模式 / Hot reload）。
    // 打包后 Vite 会在编译期把这个常量替换为 false 并 tree-shake 整个分支，
    // 用户安装包里看不到这一项。所有需要在打开真实工程下试验的开发功能都
    // 集中放这里——大工程压测、状态注入、构造特殊数据等
    ...(import.meta.env.DEV
      ? [
          {
            label: 'Dev',
            items: [
              {
                kind: 'item' as const,
                label: 'Append 100 fake segments',
                disabled: !hasProject,
                onSelect: () => useEditorStore.getState().__dev_appendFakeSegments(100)
              },
              {
                kind: 'item' as const,
                label: 'Append 500 fake segments',
                disabled: !hasProject,
                onSelect: () => useEditorStore.getState().__dev_appendFakeSegments(500)
              },
              {
                kind: 'item' as const,
                label: 'Append 1000 fake segments',
                disabled: !hasProject,
                onSelect: () => useEditorStore.getState().__dev_appendFakeSegments(1000)
              }
            ]
          }
        ]
      : [])
  ]
}

function renderItems(items: MenuItem[]): React.ReactNode {
  return items.map((it, idx) => {
    if (it.kind === 'separator') {
      return <DropdownMenu.Separator key={idx} className="my-1 h-px bg-border" />
    }
    if (it.kind === 'checkbox') {
      return (
        <DropdownMenu.CheckboxItem
          key={idx}
          checked={it.checked}
          disabled={it.disabled}
          onSelect={(e) => {
            // 阻止默认行为：dropdown 默认 select 后会关菜单，但 toggle 类
            // 操作通常希望菜单保持打开让用户连续切多个 panel
            e.preventDefault()
            it.onSelect?.()
          }}
          className={cn(
            'relative flex items-center justify-between gap-6 px-3 py-1.5 pl-6 text-xs outline-none',
            'data-[highlighted]:bg-accent data-[highlighted]:text-white',
            'data-[disabled]:text-fg-dim data-[disabled]:pointer-events-none'
          )}
        >
          <DropdownMenu.ItemIndicator className="absolute left-1.5">
            <Check size={11} />
          </DropdownMenu.ItemIndicator>
          <span>{it.label}</span>
        </DropdownMenu.CheckboxItem>
      )
    }
    if (it.kind === 'radioGroup') {
      return (
        <DropdownMenu.RadioGroup key={idx} value={it.value} onValueChange={it.onValueChange}>
          {it.options.map((opt) => (
            <DropdownMenu.RadioItem
              key={opt.value}
              value={opt.value}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 pl-6 text-xs outline-none',
                'relative data-[highlighted]:bg-accent data-[highlighted]:text-white'
              )}
            >
              <DropdownMenu.ItemIndicator className="absolute left-1.5">
                <Check size={11} />
              </DropdownMenu.ItemIndicator>
              <span>{opt.label}</span>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      )
    }
    if (it.kind === 'submenu') {
      return (
        <DropdownMenu.Sub key={idx}>
          <DropdownMenu.SubTrigger
            className={cn(
              'flex items-center justify-between gap-6 px-3 py-1.5 text-xs outline-none',
              'data-[highlighted]:bg-accent data-[highlighted]:text-white'
            )}
          >
            <span>{it.label}</span>
            <ChevronRight size={12} />
          </DropdownMenu.SubTrigger>
          <DropdownMenu.Portal>
            <DropdownMenu.SubContent
              sideOffset={-2}
              alignOffset={-4}
              className="min-w-[220px] rounded-sm border border-border bg-bg-panel py-1 shadow-xl"
            >
              {renderItems(it.items)}
            </DropdownMenu.SubContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Sub>
      )
    }
    return (
      <DropdownMenu.Item
        key={idx}
        disabled={it.disabled}
        onSelect={it.onSelect}
        className={cn(
          'flex items-center justify-between gap-6 px-3 py-1.5 text-xs outline-none',
          'data-[highlighted]:bg-accent data-[highlighted]:text-white',
          'data-[disabled]:text-fg-dim data-[disabled]:pointer-events-none'
        )}
      >
        <span>{it.label}</span>
        {it.shortcut && (
          <span className="text-2xs text-fg-dim data-[highlighted]:text-white/80">
            {it.shortcut}
          </span>
        )}
      </DropdownMenu.Item>
    )
  })
}

function MenuButton({ menu }: { menu: MenuDef }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'no-drag h-full px-2 text-xs text-fg-muted hover:text-fg',
            'hover:bg-chrome-hover data-[state=open]:bg-chrome-hover data-[state=open]:text-fg',
            'outline-none'
          )}
        >
          {menu.label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          sideOffset={0}
          align="start"
          className="min-w-[220px] rounded-sm border border-border bg-bg-panel py-1 shadow-xl"
        >
          {renderItems(menu.items)}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Titlebar(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const project = useEditorStore((s) => s.project)
  const saved = useEditorStore((s) => s.saved)
  const playback = useEditorStore((s) => s.playback)
  const openImportScript = useDialogStore((s) => s.openImportScript)
  const openPreferences = useDialogStore((s) => s.openPreferences)
  const openAbout = useDialogStore((s) => s.openAbout)
  const openAudioAudit = useDialogStore((s) => s.openAudioAudit)
  const openPanelIds = useDockStore((s) => s.openPanelIds)

  // 订阅历史栈长度与栈顶 labelKey：两者变化时菜单应重新计算。
  // 只取我们需要的标量 / 字符串，避免订阅整条 entry 对象引发不必要的重渲染
  const pastLen = useHistoryStore((s) => s.past.length)
  const futureLen = useHistoryStore((s) => s.future.length)
  const undoLabelKey = useHistoryStore((s) => s.past[s.past.length - 1]?.labelKey ?? null)
  const redoLabelKey = useHistoryStore((s) => s.future[s.future.length - 1]?.labelKey ?? null)

  // 传输菜单的快捷键标签从用户当前绑定计算。preferences 变化时整个菜单
  // 重新构建，让 Record / Play 等条目显示用户实际生效的键位
  const prefs = usePreferencesStore((s) => s.prefs)
  const bindings = resolveBindings(prefs)
  const transportShortcuts = {
    record: bindings.record ? formatBinding(bindings.record) : '',
    rerecord: bindings.rerecord ? formatBinding(bindings.rerecord) : '',
    playSegment: bindings.playSegment ? formatBinding(bindings.playSegment) : '',
    playProject: bindings.playProject ? formatBinding(bindings.playProject) : '',
    stop: bindings.stopOrCancel ? formatBinding(bindings.stopOrCancel) : ''
  }

  const [maximized, setMaximized] = useState(false)

  const hasProject = project !== null
  // 录音 / 播放期间禁用 undo / redo，和 historyStore 内部的守卫一致
  const historyCtx: HistoryMenuCtx = {
    canUndo: hasProject && playback === 'idle' && pastLen > 0,
    canRedo: hasProject && playback === 'idle' && futureLen > 0,
    undoLabelKey,
    redoLabelKey
  }

  // 依赖 i18n.language 而不是 t：t 引用在语言切换时也会变，但 language 更明确
  const menus = useMemo(
    () =>
      buildMenus(
        t,
        hasProject,
        openImportScript,
        openPreferences,
        openAbout,
        openAudioAudit,
        historyCtx,
        transportShortcuts,
        openPanelIds
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      t,
      i18n.language,
      hasProject,
      openImportScript,
      openPreferences,
      openAbout,
      openAudioAudit,
      historyCtx.canUndo,
      historyCtx.canRedo,
      historyCtx.undoLabelKey,
      historyCtx.redoLabelKey,
      transportShortcuts.record,
      transportShortcuts.rerecord,
      transportShortcuts.playSegment,
      transportShortcuts.playProject,
      transportShortcuts.stop,
      openPanelIds
    ]
  )

  useEffect(() => {
    window.api.window.isMaximized().then(setMaximized)
    const off = window.api.window.onMaximizeStateChange(setMaximized)
    return off
  }, [])

  return (
    <div className="drag-region relative flex h-8 shrink-0 items-center border-b border-border bg-chrome text-fg">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-2xs text-fg-muted">
        <span className="truncate">
          {project ? (
            <>
              {project.title}
              {!saved && <span className="text-fg-dim"> ●</span>}
              <span className="text-fg-dim"> — {t('app.title')}</span>
            </>
          ) : (
            t('app.title')
          )}
        </span>
      </div>

      <div className="no-drag relative flex h-full items-center pl-2 pr-1">
        <Mic size={14} className="text-accent" />
      </div>

      <div className="no-drag relative flex h-full items-center">
        {menus.map((menu) => (
          <MenuButton key={menu.label} menu={menu} />
        ))}
      </div>

      <div className="flex-1" />

      <div className="no-drag relative flex h-full items-center">
        <button
          onClick={() => window.api.window.minimize()}
          className="flex h-full w-11 items-center justify-center hover:bg-chrome-hover"
          aria-label="Minimize"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.api.window.toggleMaximize()}
          className="flex h-full w-11 items-center justify-center hover:bg-chrome-hover"
          aria-label={maximized ? 'Restore' : 'Maximize'}
        >
          {maximized ? <Copy size={12} className="rotate-90" /> : <Square size={11} />}
        </button>
        <button
          onClick={() => window.api.window.close()}
          className="flex h-full w-11 items-center justify-center hover:bg-rec"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
