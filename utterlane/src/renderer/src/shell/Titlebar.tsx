import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Minus, Square, Copy, X, Mic } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { useHistoryStore } from '@renderer/store/historyStore'
import { closeCurrentProject, newProject, openProject } from '@renderer/actions/project'
import { exportAudioWav, exportSubtitlesSrt } from '@renderer/actions/export'
import { useDialogStore } from '@renderer/store/dialogStore'
import { resetWorkspaceLayout } from './workspaceHandle'

type MenuItem =
  | { kind: 'item'; label: string; shortcut?: string; disabled?: boolean; onSelect?: () => void }
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
  history: HistoryMenuCtx
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
        { kind: 'item', label: t('menu.view_toggle_segments'), disabled: true },
        { kind: 'item', label: t('menu.view_toggle_inspector'), disabled: true },
        { kind: 'item', label: t('menu.view_toggle_timeline'), disabled: true }
        // Dock 主题已经整合到 Edit → Preferences 里；
        // 保留 View 菜单的「布局」概念，主题由统一偏好管理
      ]
    },
    {
      label: t('menu.transport'),
      items: [
        { kind: 'item', label: t('menu.transport_record'), shortcut: 'R' },
        { kind: 'item', label: t('menu.transport_rerecord'), shortcut: 'Shift+R' },
        { kind: 'separator' },
        { kind: 'item', label: t('menu.transport_play_segment'), shortcut: 'Space' },
        { kind: 'item', label: t('menu.transport_play_project'), shortcut: 'Shift+Space' },
        { kind: 'item', label: t('menu.transport_stop'), shortcut: 'Esc' }
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
    }
  ]
}

function renderItems(items: MenuItem[]): React.ReactNode {
  return items.map((it, idx) => {
    if (it.kind === 'separator') {
      return <DropdownMenu.Separator key={idx} className="my-1 h-px bg-border" />
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

  // 订阅历史栈长度与栈顶 labelKey：两者变化时菜单应重新计算。
  // 只取我们需要的标量 / 字符串，避免订阅整条 entry 对象引发不必要的重渲染
  const pastLen = useHistoryStore((s) => s.past.length)
  const futureLen = useHistoryStore((s) => s.future.length)
  const undoLabelKey = useHistoryStore((s) => s.past[s.past.length - 1]?.labelKey ?? null)
  const redoLabelKey = useHistoryStore((s) => s.future[s.future.length - 1]?.labelKey ?? null)

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
        historyCtx
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
      historyCtx.redoLabelKey
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
