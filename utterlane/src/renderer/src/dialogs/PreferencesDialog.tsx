import * as Dialog from '@radix-ui/react-dialog'
import { AlignCenter, AlignLeft, AlignRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_PREFERENCES, type DockThemeKey, type TextAlign } from '@shared/preferences'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { themeRegistry } from '@renderer/shell/themes'
import { cn } from '@renderer/lib/cn'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@renderer/i18n'

/**
 * 设置对话框。把分散在菜单里的 App 级偏好集中在一个地方。
 *
 * 所有字段都是「改完立即生效 + 立即写回 preferences」——
 * 没有「应用 / 取消」按钮：用户的任何调整都已经通过 preferences 写盘，
 * 关对话框本身是无副作用的。
 *
 * 分组：
 *   - 外观：Dock 主题、字体缩放、界面语言
 *   - 新工程默认：新建工程时的采样率 / 声道数
 */

/** 字体缩放的 4 档。取值范围与 App.tsx 里的 clamp 保持一致 */
const FONT_SCALE_OPTIONS: Array<{ value: number; labelKey: string }> = [
  { value: 0.85, labelKey: 'preferences.font_scale_small' },
  { value: 1, labelKey: 'preferences.font_scale_default' },
  { value: 1.15, labelKey: 'preferences.font_scale_large' },
  { value: 1.3, labelKey: 'preferences.font_scale_xlarge' }
]

const SAMPLE_RATE_OPTIONS = [44100, 48000] as const

export function PreferencesDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const prefs = usePreferencesStore((s) => s.prefs)
  const update = usePreferencesStore((s) => s.update)

  const appearance = prefs.appearance ?? DEFAULT_PREFERENCES.appearance!
  const projectDefaults = prefs.projectDefaults ?? DEFAULT_PREFERENCES.projectDefaults!

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex w-[560px] max-w-[90vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
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

          <div className="flex flex-col gap-5 overflow-y-auto px-4 py-3">
            <Section title={t('preferences.section_appearance')}>
              <Row label={t('preferences.label_dock_theme')}>
                <Select
                  value={appearance.dockTheme ?? 'dark'}
                  onChange={(v) => update({ appearance: { dockTheme: v as DockThemeKey } })}
                  options={themeRegistry.map((th) => ({ value: th.key, label: th.label }))}
                />
              </Row>

              <Row label={t('preferences.label_font_scale')}>
                <div className="flex gap-1">
                  {FONT_SCALE_OPTIONS.map((opt) => {
                    const isCurrent = (appearance.fontScale ?? 1) === opt.value
                    return (
                      <button
                        key={opt.value}
                        onClick={() => update({ appearance: { fontScale: opt.value } })}
                        className={cn(
                          'h-6 flex-1 rounded-sm border px-2 text-2xs',
                          isCurrent
                            ? 'border-accent bg-accent text-white'
                            : 'border-border bg-bg-raised text-fg hover:border-border-strong'
                        )}
                      >
                        {t(opt.labelKey)}
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
                      loc === 'zh-CN'
                        ? t('preferences.language_zh_cn')
                        : t('preferences.language_en_us')
                  }))}
                />
              </Row>

              <Row label={t('preferences.label_segment_text_align')}>
                <AlignPicker
                  value={
                    appearance.segmentTextAlign ?? DEFAULT_PREFERENCES.appearance!.segmentTextAlign!
                  }
                  onChange={(v) => update({ appearance: { segmentTextAlign: v } })}
                />
              </Row>

              <Row label={t('preferences.label_inspector_text_align')}>
                <AlignPicker
                  value={
                    appearance.inspectorTextAlign ??
                    DEFAULT_PREFERENCES.appearance!.inspectorTextAlign!
                  }
                  onChange={(v) => update({ appearance: { inspectorTextAlign: v } })}
                />
              </Row>
            </Section>

            <Section title={t('preferences.section_project_defaults')}>
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
            </Section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-2xs font-semibold uppercase tracking-wider text-fg-dim">{title}</div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 text-right text-2xs text-fg-muted">{label}</div>
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
