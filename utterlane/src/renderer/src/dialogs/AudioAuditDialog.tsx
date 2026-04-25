import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, FileQuestion, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuditScanResult, MissingTake, OrphanFile } from '@shared/audio-audit'
import { useEditorStore } from '@renderer/store/editorStore'
import { showError, showSuccess } from '@renderer/store/toastStore'
import { cn } from '@renderer/lib/cn'

/**
 * 音频文件审计对话框。
 *
 * 两个并列分区：
 *   - 缺失 Take：segments.json 引用了 Take 但磁盘文件丢失。提供「指定 WAV…」
 *     按钮让用户从任意位置挑一个 WAV，main 侧复制到期望路径并算新 durationMs，
 *     UI 同步更新 Take 的 durationMs，并把 takeId 从 missingTakeIds 移除
 *   - 孤儿 WAV：audios/ 里没人引用的 WAV。提供「保存为 Take…」（选一个
 *     Segment 把孤儿 rename 成它的新 Take）和「删除」（移入系统回收站）
 *
 * 对话框打开时自动触发一次扫描；用户也可以手动点「重新扫描」。修复操作完成
 * 后会重扫，避免列表显示陈旧。
 *
 * 这些操作不进入 undo / redo 栈——它们是修复性动作，且涉及文件系统副作用，
 * 撤销没有意义（同录音的处理一致）。
 */
export function AudioAuditDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [scan, setScan] = useState<AuditScanResult | null>(null)
  const [scanning, setScanning] = useState(false)

  async function rescan(): Promise<void> {
    setScanning(true)
    try {
      const result = await window.api.audioAudit.scan()
      setScan(result)
      // 扫描结果同步给 editorStore，让 Inspector 之类的徽标实时更新
      useEditorStore.getState().setMissingTakeIds(result.missing.map((m) => m.takeId))
    } finally {
      setScanning(false)
    }
  }

  // 打开时扫一次；关闭时清空，避免下次打开闪一帧旧数据
  useEffect(() => {
    if (open) {
      void rescan()
    } else {
      setScan(null)
    }
  }, [open])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex h-[640px] w-[760px] max-h-[90vh] max-w-[92vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
            'focus:outline-none'
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-xs text-fg">{t('audit_dialog.title')}</Dialog.Title>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void rescan()}
                disabled={scanning}
                className={cn(
                  'flex h-6 items-center gap-1 rounded-sm border border-border bg-bg-raised px-2 text-2xs',
                  'hover:border-border-strong disabled:opacity-50'
                )}
              >
                <RefreshCw size={10} className={scanning ? 'animate-spin' : ''} />
                {t('audit_dialog.rescan')}
              </button>
              <Dialog.Close
                className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
                aria-label={t('common.close')}
              >
                <X size={12} />
              </Dialog.Close>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3">
            <MissingSection
              items={scan?.missing ?? []}
              loading={scan === null}
              onAfterRemap={() => void rescan()}
            />
            <OrphanSection
              items={scan?.orphans ?? []}
              loading={scan === null}
              onAfterChange={() => void rescan()}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ---------------------------------------------------------------------------
// 缺失 Take 分区
// ---------------------------------------------------------------------------

function MissingSection({
  items,
  loading,
  onAfterRemap
}: {
  items: MissingTake[]
  loading: boolean
  onAfterRemap: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const applyRemapResult = useEditorStore((s) => s.applyRemapResult)

  async function handleRemap(item: MissingTake): Promise<void> {
    const result = await window.api.audioAudit.remap(item.segmentId, item.takeId)
    if (result.ok) {
      applyRemapResult(item.segmentId, item.takeId, result.durationMs)
      showSuccess(t('audit_dialog.toast_remap_success'), item.segmentText)
      onAfterRemap()
    } else if (!result.canceled) {
      showError(t('audit_dialog.toast_remap_failure'), result.message)
    }
  }

  return (
    <Section
      title={t('audit_dialog.section_missing')}
      hint={t('audit_dialog.section_missing_hint')}
      icon={<AlertTriangle size={12} className="text-rec" />}
      count={items.length}
    >
      {loading ? (
        <SectionLoading />
      ) : items.length === 0 ? (
        <SectionEmpty text={t('audit_dialog.section_missing_empty')} />
      ) : (
        <table className="w-full text-2xs">
          <thead>
            <tr className="border-b border-border-subtle text-fg-dim">
              <th className="w-10 px-2 py-1 text-right">{t('audit_dialog.column_segment')}</th>
              <th className="px-2 py-1 text-left">{t('audit_dialog.column_text')}</th>
              <th className="px-2 py-1 text-left">{t('audit_dialog.column_path')}</th>
              <th className="w-32 px-2 py-1 text-right">{t('audit_dialog.column_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.takeId} className="border-b border-border-subtle hover:bg-bg-raised">
                <td className="px-2 py-1 text-right font-mono tabular-nums text-fg-muted">
                  {item.segmentIndex + 1}
                </td>
                <td className="max-w-[200px] truncate px-2 py-1 text-fg" title={item.segmentText}>
                  {item.segmentText}
                </td>
                <td
                  className="max-w-[260px] truncate px-2 py-1 font-mono text-fg-muted"
                  title={item.expectedPath}
                >
                  {item.expectedPath}
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    onClick={() => void handleRemap(item)}
                    className={cn(
                      'h-5 rounded-sm border border-border bg-bg-deep px-2 text-2xs text-fg',
                      'hover:border-accent hover:text-accent'
                    )}
                  >
                    {t('audit_dialog.btn_remap')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 孤儿 WAV 分区
// ---------------------------------------------------------------------------

function OrphanSection({
  items,
  loading,
  onAfterChange
}: {
  items: OrphanFile[]
  loading: boolean
  onAfterChange: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const order = useEditorStore((s) => s.order)
  const segmentsById = useEditorStore((s) => s.segmentsById)
  const appendTakeFromOrphan = useEditorStore((s) => s.appendTakeFromOrphan)
  const [pickingFor, setPickingFor] = useState<string | null>(null)

  async function handleSaveAsTake(orphan: OrphanFile, segmentId: string): Promise<void> {
    setPickingFor(null)
    const result = await window.api.audioAudit.saveOrphanAsTake(orphan.relativePath, segmentId)
    if (result.ok) {
      appendTakeFromOrphan(segmentId, {
        id: result.takeId,
        filePath: result.relativePath,
        durationMs: result.durationMs
      })
      showSuccess(t('audit_dialog.toast_save_as_take_success'), result.relativePath)
      onAfterChange()
    } else {
      showError(t('audit_dialog.toast_save_as_take_failure'), result.message)
    }
  }

  async function handleDelete(orphan: OrphanFile): Promise<void> {
    const result = await window.api.audioAudit.deleteOrphan(orphan.relativePath)
    if (result.ok) {
      showSuccess(t('audit_dialog.toast_delete_success'), orphan.relativePath)
      onAfterChange()
    } else {
      showError(t('audit_dialog.toast_delete_failure'), result.message)
    }
  }

  return (
    <Section
      title={t('audit_dialog.section_orphans')}
      hint={t('audit_dialog.section_orphans_hint')}
      icon={<FileQuestion size={12} className="text-yellow-500" />}
      count={items.length}
    >
      {loading ? (
        <SectionLoading />
      ) : items.length === 0 ? (
        <SectionEmpty text={t('audit_dialog.section_orphans_empty')} />
      ) : (
        <table className="w-full text-2xs">
          <thead>
            <tr className="border-b border-border-subtle text-fg-dim">
              <th className="px-2 py-1 text-left">{t('audit_dialog.column_file')}</th>
              <th className="w-20 px-2 py-1 text-right">{t('audit_dialog.column_size')}</th>
              <th className="w-32 px-2 py-1 text-right">{t('audit_dialog.column_mtime')}</th>
              <th className="w-48 px-2 py-1 text-right">{t('audit_dialog.column_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((orphan) => (
              <tr
                key={orphan.relativePath}
                className="border-b border-border-subtle hover:bg-bg-raised"
              >
                <td
                  className="max-w-[280px] truncate px-2 py-1 font-mono text-fg-muted"
                  title={orphan.relativePath}
                >
                  {orphan.relativePath}
                </td>
                <td className="px-2 py-1 text-right font-mono text-fg-muted">
                  {formatBytes(orphan.sizeBytes)}
                </td>
                <td className="px-2 py-1 text-right font-mono text-fg-muted">
                  {formatDate(orphan.mtimeMs)}
                </td>
                <td className="px-2 py-1">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => setPickingFor(orphan.relativePath)}
                      className={cn(
                        'h-5 rounded-sm border border-border bg-bg-deep px-2 text-2xs text-fg',
                        'hover:border-accent hover:text-accent'
                      )}
                    >
                      {t('audit_dialog.btn_save_as_take')}
                    </button>
                    <button
                      onClick={() => void handleDelete(orphan)}
                      className={cn(
                        'flex h-5 items-center gap-1 rounded-sm border border-border bg-bg-deep px-2 text-2xs text-fg',
                        'hover:border-rec hover:text-rec'
                      )}
                    >
                      <Trash2 size={10} />
                      {t('audit_dialog.btn_delete_orphan')}
                    </button>
                  </div>
                  {pickingFor === orphan.relativePath && (
                    <SegmentPicker
                      onCancel={() => setPickingFor(null)}
                      onPick={(segId) => void handleSaveAsTake(orphan, segId)}
                      order={order}
                      segmentsById={segmentsById}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

/**
 * 内联 Segment 选择器：「保存为 Take」按钮点开后展开一个紧凑下拉。
 * 不用嵌套 Dialog 是因为我们已经在一个 Dialog 里了，套娃的层级管理麻烦。
 */
function SegmentPicker({
  order,
  segmentsById,
  onCancel,
  onPick
}: {
  order: string[]
  segmentsById: Record<string, { text: string }>
  onCancel: () => void
  onPick: (segmentId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-1 flex flex-col gap-1 rounded-sm border border-accent bg-bg-deep p-2">
      <div className="text-2xs text-fg-dim">{t('audit_dialog.save_as_take_dialog_desc')}</div>
      <select
        autoFocus
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value)
        }}
        className="h-6 w-full rounded-sm border border-border bg-bg-deep px-2 text-2xs text-fg"
      >
        <option value="" disabled>
          {t('audit_dialog.save_as_take_dialog_title')}
        </option>
        {order.map((id, i) => (
          <option key={id} value={id}>
            {i + 1}. {segmentsById[id]?.text.slice(0, 40) ?? ''}
          </option>
        ))}
      </select>
      <button onClick={onCancel} className="self-end text-2xs text-fg-muted hover:text-fg">
        {t('common.cancel')}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 共享小组件
// ---------------------------------------------------------------------------

function Section({
  title,
  hint,
  icon,
  count,
  children
}: {
  title: string
  hint: string
  icon: React.ReactNode
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-border bg-bg-deep">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-2xs font-semibold uppercase tracking-wider text-fg">{title}</span>
          <span className="text-2xs text-fg-dim">({count})</span>
        </div>
        <span className="text-2xs text-fg-dim">{hint}</span>
      </div>
      <div className="px-1 pb-1">{children}</div>
    </div>
  )
}

function SectionEmpty({ text }: { text: string }): React.JSX.Element {
  return <div className="py-3 text-center text-2xs text-fg-dim">{text}</div>
}

function SectionLoading(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-2xs text-fg-dim">
      <RefreshCw size={10} className="animate-spin" />…
    </div>
  )
}

// ---------------------------------------------------------------------------
// 格式化
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}
