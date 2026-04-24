import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { X } from 'lucide-react'
import { useEditorStore } from '@renderer/store/editorStore'
import { confirm } from '@renderer/store/confirmStore'
import { cn } from '@renderer/lib/cn'

/**
 * 文案导入对话框。
 *
 * 当前的实现只支持「粘贴文本」；后续可以在这里加一个「从文件导入」按钮
 * （走 window.api.project 暴露一个读文件的入口）。
 *
 * 覆盖行为：导入会替换当前全部 Segments。如果当前已经有内容，在 UI 上给出警告。
 */
export function ImportScriptDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const segmentsCount = useEditorStore((s) => s.order.length)
  const importScript = useEditorStore((s) => s.importScript)
  const [text, setText] = useState('')

  const lineCount = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length

  const onConfirm = async (): Promise<void> => {
    if (lineCount === 0) return
    if (segmentsCount > 0) {
      const ok = await confirm({
        title: '替换已有 Segments？',
        description: `当前工程已有 ${segmentsCount} 条 Segment，导入会全部替换。`,
        confirmLabel: '替换',
        tone: 'danger'
      })
      if (!ok) return
    }
    importScript(text)
    setText('')
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex w-[640px] max-w-[90vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
            'focus:outline-none'
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-xs text-fg">导入文案</Dialog.Title>
            <Dialog.Close
              className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
              aria-label="关闭"
            >
              <X size={12} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-2 px-3 py-3">
            <Dialog.Description className="text-2xs text-fg-muted">
              粘贴文案，每行会被拆分为一个 Segment（空行会被忽略）。
            </Dialog.Description>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="在这里粘贴你的文案…"
              rows={12}
              className={cn(
                'w-full resize-none rounded-sm border border-border bg-bg-deep px-2 py-1.5',
                'font-mono text-xs leading-5 text-fg outline-none focus:border-accent'
              )}
              autoFocus
            />

            <div className="text-2xs text-fg-dim">
              将生成 <span className="text-fg">{lineCount}</span> 条 Segment
              {segmentsCount > 0 && (
                <span className="ml-2 text-rec">· 当前已有 {segmentsCount} 条，导入会替换</span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
            <Dialog.Close
              className={cn(
                'h-6 rounded-sm border border-border bg-bg-raised px-3 text-2xs text-fg',
                'hover:border-border-strong hover:bg-chrome-hover'
              )}
            >
              取消
            </Dialog.Close>
            <button
              onClick={onConfirm}
              disabled={lineCount === 0}
              className={cn(
                'h-6 rounded-sm border border-accent bg-accent px-3 text-2xs text-white',
                'hover:bg-accent/90',
                'disabled:cursor-not-allowed disabled:opacity-40'
              )}
            >
              导入 {lineCount > 0 && `(${lineCount})`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
