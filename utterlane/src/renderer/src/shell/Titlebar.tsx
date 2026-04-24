import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight, Minus, Square, Copy, X, Mic } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { DEFAULT_PREFERENCES, type DockThemeKey } from '@shared/preferences'
import { closeCurrentProject, newProject, openProject } from '@renderer/actions/project'
import { themeRegistry } from './themes'

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

function buildMenus(
  themeKey: DockThemeKey,
  setTheme: (key: DockThemeKey) => void,
  hasProject: boolean
): MenuDef[] {
  return [
    {
      label: 'File',
      items: [
        { kind: 'item', label: 'New Project…', shortcut: 'Ctrl+N', onSelect: newProject },
        { kind: 'item', label: 'Open Project…', shortcut: 'Ctrl+O', onSelect: openProject },
        {
          kind: 'item',
          label: 'Close Project',
          disabled: !hasProject,
          onSelect: closeCurrentProject
        },
        { kind: 'separator' },
        { kind: 'item', label: 'Save', shortcut: 'Ctrl+S', disabled: !hasProject },
        { kind: 'separator' },
        { kind: 'item', label: 'Import Script…', disabled: !hasProject },
        {
          kind: 'submenu',
          label: 'Export',
          items: [
            { kind: 'item', label: 'Export Audio (WAV)…', disabled: !hasProject },
            { kind: 'item', label: 'Export Subtitles (SRT)…', disabled: !hasProject }
          ]
        },
        { kind: 'separator' },
        {
          kind: 'item',
          label: 'Exit',
          shortcut: 'Alt+F4',
          onSelect: () => window.api.window.close()
        }
      ]
    },
    {
      label: 'Edit',
      items: [
        { kind: 'item', label: 'Undo', shortcut: 'Ctrl+Z', disabled: true },
        { kind: 'item', label: 'Redo', shortcut: 'Ctrl+Y', disabled: true },
        { kind: 'separator' },
        { kind: 'item', label: 'Delete', shortcut: 'Delete' }
      ]
    },
    {
      label: 'View',
      items: [
        { kind: 'item', label: 'Reset Layout' },
        { kind: 'separator' },
        { kind: 'item', label: 'Toggle Segments Panel' },
        { kind: 'item', label: 'Toggle Inspector Panel' },
        { kind: 'item', label: 'Toggle Timeline Panel' },
        { kind: 'separator' },
        {
          kind: 'submenu',
          label: 'Dock Theme (预览)',
          items: [
            {
              kind: 'radioGroup',
              value: themeKey,
              onValueChange: (v) => setTheme(v as DockThemeKey),
              options: themeRegistry.map((t) => ({ value: t.key, label: t.label }))
            }
          ]
        }
      ]
    },
    {
      label: 'Transport',
      items: [
        { kind: 'item', label: 'Record', shortcut: 'R' },
        { kind: 'item', label: 'Re-record', shortcut: 'Shift+R' },
        { kind: 'separator' },
        { kind: 'item', label: 'Play Current Segment', shortcut: 'Space' },
        { kind: 'item', label: 'Play Project', shortcut: 'Shift+Space' },
        { kind: 'item', label: 'Stop', shortcut: 'Esc' }
      ]
    },
    {
      label: 'Help',
      items: [
        { kind: 'item', label: 'About Utterlane' },
        { kind: 'item', label: 'License (MPL-2.0)' },
        { kind: 'item', label: 'Project Homepage' }
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
  const project = useEditorStore((s) => s.project)
  const saved = useEditorStore((s) => s.saved)
  const themeKey = usePreferencesStore(
    (s) => s.prefs.appearance?.dockTheme ?? DEFAULT_PREFERENCES.appearance!.dockTheme!
  )
  const updatePrefs = usePreferencesStore((s) => s.update)
  const [maximized, setMaximized] = useState(false)

  const hasProject = project !== null

  // buildMenus 被 theme/prefs/project 改动驱动重建。setTheme 回调写回 preferences，
  // 主进程广播后 store 自动刷新，从而驱动下次重建，形成闭环。
  const menus = useMemo(
    () =>
      buildMenus(themeKey, (key) => updatePrefs({ appearance: { dockTheme: key } }), hasProject),
    [themeKey, updatePrefs, hasProject]
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
              <span className="text-fg-dim"> — Utterlane</span>
            </>
          ) : (
            'Utterlane'
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
