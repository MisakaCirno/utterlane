import * as Dialog from '@radix-ui/react-dialog'
import { AlignCenter, AlignLeft, AlignRight, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CUSTOMIZABLE_ACTIONS,
  DEFAULT_KEYBINDINGS,
  DEFAULT_PREFERENCES,
  FONT_SCALE_OPTIONS,
  formatBinding,
  resolveBindings,
  type CustomizableActionId,
  type DockThemeKey,
  type KeyBinding,
  type TextAlign
} from '@shared/preferences'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { themeRegistry } from '@renderer/shell/themes'
import { cn } from '@renderer/lib/cn'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@renderer/i18n'
import { enumerateInputDevices, type AudioInputDevice } from '@renderer/services/recorder'

/**
 * 设置对话框。
 *
 * === 分页布局 ===
 *
 * 旧版本是一长条向下滚动，4 个分组上下排开。新版本左侧是分页列表，
 * 右侧渲染当前页内容——更接近 IDE / OS 系统设置的常见样式，方便后续
 * 加入新页（每加一个 PAGES 条目即可，无需调整对话框其它部分）。
 *
 * 所有字段都是「改完立即生效 + 立即写回 preferences」——没有「应用 /
 * 取消」按钮：用户的任何调整都已经通过 preferences 写盘，关对话框本身
 * 是无副作用的。
 */

/**
 * 字体缩放档位的展示标签。值列表来自 shared/preferences 的 FONT_SCALE_OPTIONS——
 * 共用一份保证 clamp 范围与 UI 选项不脱节
 */
const FONT_SCALE_LABEL_KEYS: Record<number, string> = {
  0.85: 'preferences.font_scale_small',
  1: 'preferences.font_scale_default',
  1.15: 'preferences.font_scale_large',
  1.3: 'preferences.font_scale_xlarge'
}

const SAMPLE_RATE_OPTIONS = [44100, 48000] as const

/**
 * 倒计时档位。0 = 关；1 秒已经足够避开「点击录音键的按键音」被录入起头。
 * 3 / 5 适合需要一点时间清嗓子 / 调整状态的用户。
 */
const COUNTDOWN_OPTIONS = [0, 1, 3, 5] as const

type PageId = 'appearance' | 'projectDefaults' | 'recording' | 'keyboard'

const PAGES: Array<{ id: PageId; labelKey: string }> = [
  { id: 'appearance', labelKey: 'preferences.section_appearance' },
  { id: 'projectDefaults', labelKey: 'preferences.section_project_defaults' },
  { id: 'recording', labelKey: 'preferences.section_recording' },
  { id: 'keyboard', labelKey: 'preferences.section_keyboard' }
]

export function PreferencesDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [page, setPage] = useState<PageId>('appearance')

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            // 固定高度避免切页时对话框上下抖动；分页内容更长时由右侧
            // overflow-y-auto 接管成纵向滚动
            'flex h-[480px] w-[640px] max-h-[85vh] max-w-[92vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
            'focus:outline-none'
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-xs text-fg">{t('preferences.title')}</Dialog.Title>
            <Dialog.Close
              className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
              aria-label={t('common.close')}
            >
              <X size={12} />
            </Dialog.Close>
          </div>

          {/* 主体：左 = 分页列表（固定宽），右 = 当前页内容（独立纵向滚动） */}
          <div className="flex min-h-0 flex-1">
            <nav className="flex w-36 shrink-0 flex-col border-r border-border bg-bg py-2">
              {PAGES.map((p) => {
                const isActive = page === p.id
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPage(p.id)}
                    className={cn(
                      'flex h-7 items-center px-3 text-left text-xs',
                      isActive
                        ? 'border-l-2 border-accent bg-accent-soft/40 pl-[10px] text-fg'
                        : 'border-l-2 border-transparent text-fg-muted hover:bg-chrome-hover hover:text-fg'
                    )}
                  >
                    {t(p.labelKey)}
                  </button>
                )
              })}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-4 py-3">
              {page === 'appearance' && <AppearancePage />}
              {page === 'projectDefaults' && <ProjectDefaultsPage />}
              {page === 'recording' && <RecordingPage open={open} />}
              {page === 'keyboard' && <KeyboardPage />}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ===========================================================================
// 各分页内容
// ===========================================================================

function AppearancePage(): React.JSX.Element {
  const { t } = useTranslation()
  const prefs = usePreferencesStore((s) => s.prefs)
  const update = usePreferencesStore((s) => s.update)
  const appearance = prefs.appearance ?? DEFAULT_PREFERENCES.appearance!

  return (
    <PageBody>
      <Row label={t('preferences.label_dock_theme')}>
        <Select
          value={appearance.dockTheme ?? 'dark'}
          onChange={(v) => update({ appearance: { dockTheme: v as DockThemeKey } })}
          options={themeRegistry.map((th) => ({ value: th.key, label: th.label }))}
        />
      </Row>

      <Row label={t('preferences.label_font_scale')}>
        <div className="flex gap-1">
          {FONT_SCALE_OPTIONS.map((value) => {
            const isCurrent = (appearance.fontScale ?? 1) === value
            const labelKey = FONT_SCALE_LABEL_KEYS[value] ?? 'preferences.font_scale_default'
            return (
              <button
                key={value}
                onClick={() => update({ appearance: { fontScale: value } })}
                className={cn(
                  'h-6 flex-1 rounded-sm border px-2 text-2xs',
                  isCurrent
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-bg-raised text-fg hover:border-border-strong'
                )}
              >
                {t(labelKey)}
              </button>
            )
          })}
        </div>
      </Row>

      <Row label={t('preferences.label_language')}>
        <Select
          value={appearance.locale ?? 'zh-CN'}
          onChange={(v) => update({ appearance: { locale: v as SupportedLocale } })}
          options={SUPPORTED_LOCALES.map((loc) => ({
            value: loc,
            label:
              loc === 'zh-CN' ? t('preferences.language_zh_cn') : t('preferences.language_en_us')
          }))}
        />
      </Row>

      <Row label={t('preferences.label_segment_text_align')}>
        <AlignPicker
          value={appearance.segmentTextAlign ?? DEFAULT_PREFERENCES.appearance!.segmentTextAlign!}
          onChange={(v) => update({ appearance: { segmentTextAlign: v } })}
        />
      </Row>

      <Row label={t('preferences.label_inspector_text_align')}>
        <AlignPicker
          value={
            appearance.inspectorTextAlign ?? DEFAULT_PREFERENCES.appearance!.inspectorTextAlign!
          }
          onChange={(v) => update({ appearance: { inspectorTextAlign: v } })}
        />
      </Row>
    </PageBody>
  )
}

function ProjectDefaultsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const prefs = usePreferencesStore((s) => s.prefs)
  const update = usePreferencesStore((s) => s.update)
  const projectDefaults = prefs.projectDefaults ?? DEFAULT_PREFERENCES.projectDefaults!

  return (
    <PageBody>
      <Row label={t('preferences.label_sample_rate')}>
        <Select
          value={String(projectDefaults.sampleRate ?? 48000)}
          onChange={(v) => update({ projectDefaults: { sampleRate: Number(v) } })}
          options={SAMPLE_RATE_OPTIONS.map((sr) => ({
            value: String(sr),
            label: `${sr} Hz`
          }))}
        />
      </Row>

      <Row label={t('preferences.label_channels')}>
        <Select
          value={String(projectDefaults.channels ?? 1)}
          onChange={(v) => update({ projectDefaults: { channels: Number(v) as 1 | 2 } })}
          options={[
            { value: '1', label: t('project_settings.channel_mono') },
            { value: '2', label: t('project_settings.channel_stereo') }
          ]}
        />
      </Row>
    </PageBody>
  )
}

function RecordingPage({ open }: { open: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  const prefs = usePreferencesStore((s) => s.prefs)
  const update = usePreferencesStore((s) => s.update)
  const recording = prefs.recording ?? DEFAULT_PREFERENCES.recording!

  // 输入设备列表只在对话框打开时拉取一次。设备热插拔不算高频事件，用户
  // 重开对话框就能刷新。如果以后要做 hot-reload，订阅
  // navigator.mediaDevices.devicechange 即可
  const [inputDevices, setInputDevices] = useState<AudioInputDevice[]>([])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void enumerateInputDevices().then((devices) => {
      if (!cancelled) setInputDevices(devices)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <PageBody>
      <Row label={t('preferences.label_input_device')}>
        <Select
          value={recording.inputDeviceId ?? ''}
          onChange={(v) =>
            // 选「(默认)」时存空字符串，对应 startRecording 走默认设备路径
            update({ recording: { inputDeviceId: v || undefined } })
          }
          options={[
            { value: '', label: t('preferences.input_device_default') },
            ...inputDevices.map((d) => ({ value: d.deviceId, label: d.label }))
          ]}
        />
      </Row>
      <Row label={t('preferences.label_countdown')}>
        <Select
          value={String(recording.countdownSeconds ?? 1)}
          onChange={(v) => update({ recording: { countdownSeconds: Number(v) } })}
          options={COUNTDOWN_OPTIONS.map((sec) => ({
            value: String(sec),
            label:
              sec === 0
                ? t('preferences.countdown_off')
                : t('preferences.countdown_seconds', { count: sec })
          }))}
        />
      </Row>
    </PageBody>
  )
}

/**
 * 快捷键自定义页。
 *
 * 每行展示一个动作 + 当前绑定 + 「重新绑定 / 重置」按钮。点重新绑定后
 * 进入「按键捕获模式」：行内显示「请按下新键…」并监听 keydown，捕获到
 * 第一个非纯修饰键就保存。Esc 取消捕获。
 *
 * 不做冲突检测：同一组合键允许绑给多个动作（按下时多个 dispatchAction
 * 分支会竞争，但每个分支自带 playback 状态守卫，实际并不会重复执行）。
 * UI 上对显式冲突视而不见，倾向「让用户掌控」而不是「替用户拒绝」
 */
function KeyboardPage(): React.JSX.Element {
  const { t } = useTranslation()
  const prefs = usePreferencesStore((s) => s.prefs)
  const update = usePreferencesStore((s) => s.update)
  const bindings = resolveBindings(prefs)
  const [capturing, setCapturing] = useState<CustomizableActionId | null>(null)

  // 进入捕获模式后挂全局 keydown 监听。捕获到非纯修饰键就保存；
  // Esc 取消整个捕获过程；纯修饰键（Shift / Ctrl 单独按）忽略，等组合
  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      // 单独按修饰键时 e.key 会是 'Shift' / 'Control' 等，跳过等真正的键
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
      if (e.key === 'Escape') {
        setCapturing(null)
        return
      }
      const newBinding: KeyBinding = {
        // 单字符键存小写，遇到 Shift+Letter 时通过 modifier 表达；其他键
        // （Space / ArrowUp / Escape）按原样存
        key: e.key.length === 1 ? e.key.toLowerCase() : e.key,
        ctrl: e.ctrlKey || e.metaKey || undefined,
        alt: e.altKey || undefined,
        shift: e.shiftKey || undefined
      }
      update({ keyboard: { bindings: { [capturing]: newBinding } } })
      setCapturing(null)
    }
    // capture: true 让我们抢在 isEditableTarget 守卫之前——捕获模式下应当
    // 拿到所有按键（用户可能想绑特殊键给录音）
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [capturing, update])

  return (
    <PageBody>
      {CUSTOMIZABLE_ACTIONS.map((id) => {
        const current = bindings[id]
        const isDefault = bindingsEqual(current, DEFAULT_KEYBINDINGS[id])
        const isCapturing = capturing === id
        return (
          <div key={id} className="flex items-center gap-3">
            <div className="w-32 shrink-0 text-2xs text-fg-muted">
              {t(`preferences.kb_action_${id}`)}
            </div>
            <div className="flex-1">
              {isCapturing ? (
                <div className="flex h-6 items-center justify-center rounded-sm border border-accent bg-accent/10 px-2 text-2xs text-accent">
                  {t('preferences.kb_press_keys')}
                </div>
              ) : (
                <button
                  onClick={() => setCapturing(id)}
                  className={cn(
                    'flex h-6 w-full items-center justify-center rounded-sm border bg-bg-deep px-2 text-2xs',
                    'border-border hover:border-accent'
                  )}
                >
                  {current ? formatBinding(current) : t('preferences.kb_unbound')}
                </button>
              )}
            </div>
            <button
              disabled={isDefault}
              onClick={() => update({ keyboard: { bindings: { [id]: undefined } } })}
              className={cn(
                'h-6 w-12 shrink-0 rounded-sm border border-border bg-bg-raised text-2xs text-fg',
                'hover:border-border-strong disabled:opacity-40 disabled:hover:border-border'
              )}
            >
              {t('preferences.kb_reset')}
            </button>
          </div>
        )
      })}
    </PageBody>
  )
}

function bindingsEqual(a: KeyBinding | null, b: KeyBinding | null): boolean {
  if (a === null || b === null) return a === b
  return a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift
}

// ===========================================================================
// 共用 sub-components
// ===========================================================================

/** 分页内容的统一外壳。各页只需关心自己的 Row 列表 */
function PageBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-col gap-2">{children}</div>
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-right text-2xs text-fg-muted">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

/**
 * 三按钮组：左 / 中 / 右对齐。active 的那一个用 accent 背景高亮。
 * 比 Select 更直观——按钮里的图标就是对齐效果本身。
 */
function AlignPicker({
  value,
  onChange
}: {
  value: TextAlign
  onChange: (v: TextAlign) => void
}): React.JSX.Element {
  const items: Array<{ value: TextAlign; icon: React.ReactNode }> = [
    { value: 'left', icon: <AlignLeft size={12} /> },
    { value: 'center', icon: <AlignCenter size={12} /> },
    { value: 'right', icon: <AlignRight size={12} /> }
  ]
  return (
    <div className="flex gap-1">
      {items.map((it) => {
        const isCurrent = it.value === value
        return (
          <button
            key={it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              'flex h-6 flex-1 items-center justify-center rounded-sm border',
              isCurrent
                ? 'border-accent bg-accent text-white'
                : 'border-border bg-bg-raised text-fg-muted hover:border-border-strong hover:text-fg'
            )}
          >
            {it.icon}
          </button>
        )
      })}
    </div>
  )
}

function Select({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-6 w-full rounded-sm border border-border bg-bg-deep px-2 text-xs text-fg',
        'outline-none focus:border-accent'
      )}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )
}
