import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  COMMON_SAMPLE_RATES,
  type ExportAudioOptions,
  type ExportMode,
  type ExportSampleFormat
} from '@shared/export'

/**
 * 静音填充档位：从「不填」到一秒。1 秒以上的需求很少（用户如果真要长间距
 * 多半是在做章节切分，那种场景应当走拆分模式），不提供更长选项
 */
const SILENCE_OPTIONS = [0, 100, 250, 500, 1000] as const

/**
 * 峰值归一化目标 dB。-3 是最常用的「保留 headroom」档位；-1 接近最大化；
 * -6 / -12 给希望在后期还有 headroom 的用户。0 = 不归一化
 */
const PEAK_TARGET_OPTIONS = [
  { value: 0, labelKey: 'export_dialog.peak_off' as const },
  { value: -1, labelKey: 'export_dialog.peak_minus_1' as const },
  { value: -3, labelKey: 'export_dialog.peak_minus_3' as const },
  { value: -6, labelKey: 'export_dialog.peak_minus_6' as const },
  { value: -12, labelKey: 'export_dialog.peak_minus_12' as const }
] as const
import { useEditorStore } from '@renderer/store/editorStore'
import { runExportAudioWav } from '@renderer/actions/export'
import { cn } from '@renderer/lib/cn'

/**
 * 导出音频对话框。
 *
 * 用户可以选：
 *   - 拼接成一个 WAV（默认）/ 每段拆成单独 WAV
 *   - 输出采样率：跟随工程，或常见档（22050 / 44100 / 48000 / 96000）
 *     不同于工程采样率时由 main 侧重采样器处理
 *   - 位深：16-bit PCM / 24-bit PCM / 32-bit float
 *
 * 没有「应用 / 取消」式两步流：用户点「导出」直接关对话框 + 触发 IPC，
 * IPC 进而弹原生保存 / 文件夹选择对话框。两个对话框看起来像两步，但
 * 第一步是「设置」第二步是「保存位置」，符合用户对导出流程的常见预期。
 */
export function ExportDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const projectSampleRate = useEditorStore((s) => s.project?.audio.sampleRate ?? 48000)

  const [mode, setMode] = useState<ExportMode>('concat')
  const [format, setFormat] = useState<ExportSampleFormat>('pcm16')
  // 默认跟随工程采样率（用 0 作为 sentinel，提交时再用 projectSampleRate 替换）
  const [sampleRate, setSampleRate] = useState<number>(0)
  const [silenceMs, setSilenceMs] = useState<number>(0)
  // 0 = 不归一化的 sentinel（peakDb 取值范围本来就是负数 + 0 边界，0 表示「不做」）
  const [peakDb, setPeakDb] = useState<number>(0)

  function handleExport(): void {
    const options: ExportAudioOptions = {
      sampleRate: sampleRate === 0 ? projectSampleRate : sampleRate,
      format,
      mode,
      effects: {
        silencePaddingMs: silenceMs > 0 ? silenceMs : undefined,
        peakNormalizeDb: peakDb < 0 ? peakDb : undefined
      }
    }
    onOpenChange(false)
    // 关对话框后再触发 IPC：IPC 内部还要弹原生 file picker，UI 层不要叠两个 modal
    void runExportAudioWav(options)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex w-[480px] max-w-[90vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
            'focus:outline-none'
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-xs text-fg">{t('export_dialog.title')}</Dialog.Title>
            <Dialog.Close
              className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
              aria-label={t('common.close')}
            >
              <X size={12} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-4 py-3">
            <Section title={t('export_dialog.section_mode')}>
              <ModeOption
                checked={mode === 'concat'}
                onSelect={() => setMode('concat')}
                label={t('export_dialog.mode_concat')}
                hint={t('export_dialog.mode_concat_hint')}
              />
              <ModeOption
                checked={mode === 'split'}
                onSelect={() => setMode('split')}
                label={t('export_dialog.mode_split')}
                hint={t('export_dialog.mode_split_hint')}
              />
            </Section>

            <Section title={t('export_dialog.section_format')}>
              <Row label={t('export_dialog.label_sample_rate')}>
                <Select
                  value={String(sampleRate)}
                  onChange={(v) => setSampleRate(Number(v))}
                  options={[
                    {
                      value: '0',
                      label: t('export_dialog.sample_rate_match_project', {
                        rate: projectSampleRate
                      })
                    },
                    ...COMMON_SAMPLE_RATES.map((rate) => ({
                      value: String(rate),
                      label: `${rate} Hz`
                    }))
                  ]}
                />
              </Row>

              <Row label={t('export_dialog.label_bit_depth')}>
                <Select
                  value={format}
                  onChange={(v) => setFormat(v as ExportSampleFormat)}
                  options={[
                    { value: 'pcm16', label: t('export_dialog.bit_depth_pcm16') },
                    { value: 'pcm24', label: t('export_dialog.bit_depth_pcm24') },
                    { value: 'float32', label: t('export_dialog.bit_depth_float32') }
                  ]}
                />
              </Row>
            </Section>

            <Section title={t('export_dialog.section_effects')}>
              <Row label={t('export_dialog.label_silence_padding')}>
                <Select
                  value={String(silenceMs)}
                  onChange={(v) => setSilenceMs(Number(v))}
                  options={SILENCE_OPTIONS.map((ms) => ({
                    value: String(ms),
                    label:
                      ms === 0
                        ? t('export_dialog.silence_off')
                        : t('export_dialog.silence_ms', { count: ms })
                  }))}
                />
              </Row>
              {/*
                拆分模式下 silence 不生效，给 UI 一行解释。
                没有用 disabled 把字段灰掉，因为用户可能切回拼接模式时
                还想沿用之前选的值，保留状态体验更连贯
              */}
              {mode === 'split' && silenceMs > 0 && (
                <div className="pl-20 text-2xs text-fg-dim">
                  {t('export_dialog.silence_split_note')}
                </div>
              )}
              <Row label={t('export_dialog.label_peak_normalize')}>
                <Select
                  value={String(peakDb)}
                  onChange={(v) => setPeakDb(Number(v))}
                  options={PEAK_TARGET_OPTIONS.map((opt) => ({
                    value: String(opt.value),
                    label: t(opt.labelKey)
                  }))}
                />
              </Row>
            </Section>
          </div>

          <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-t border-border px-3">
            <Dialog.Close
              className={cn(
                'h-6 rounded-sm border border-border bg-bg-raised px-3 text-2xs text-fg',
                'hover:border-border-strong'
              )}
            >
              {t('common.cancel')}
            </Dialog.Close>
            <button
              onClick={handleExport}
              className={cn(
                'h-6 rounded-sm border border-accent bg-accent px-3 text-2xs text-white',
                'hover:opacity-90'
              )}
            >
              {t('export_dialog.btn_export')}
            </button>
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
      <div className="w-20 shrink-0 text-right text-2xs text-fg-muted">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  )
}

/**
 * 单选项卡片：左侧 radio 圆点，右侧主标题 + 副说明。
 * 点击整个卡片就选中，不要求精确点 radio 圆点。
 */
function ModeOption({
  checked,
  onSelect,
  label,
  hint
}: {
  checked: boolean
  onSelect: () => void
  label: string
  hint: string
}): React.JSX.Element {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 rounded-sm border px-3 py-2 text-left',
        checked
          ? 'border-accent bg-accent/10'
          : 'border-border bg-bg-raised hover:border-border-strong'
      )}
    >
      <div
        className={cn(
          'mt-0.5 h-3 w-3 shrink-0 rounded-full border',
          checked ? 'border-accent' : 'border-border'
        )}
      >
        {checked && <div className="m-0.5 h-2 w-2 rounded-full bg-accent" />}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="text-xs text-fg">{label}</div>
        <div className="text-2xs text-fg-dim">{hint}</div>
      </div>
    </button>
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
