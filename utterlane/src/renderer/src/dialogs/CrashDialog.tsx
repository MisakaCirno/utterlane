import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Copy, FolderOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCrashStore } from '@renderer/store/crashStore'
import { showInfo } from '@renderer/store/toastStore'
import { cn } from '@renderer/lib/cn'

/**
 * 崩溃对话框：把未捕获的异常 / Promise rejection 集中弹给用户。
 *
 * 设计原则：
 *   - 不阻塞应用：用户可以关闭对话框继续用，错误已经在日志里
 *   - 把信息组装好让用户能一键复制（提交 bug 时直接贴）
 *   - 提供「打开日志目录」入口，配合 electron-log 的轮转日志
 *
 * 同时只展示一个错误（crashStore 替换式），避免错误风暴时弹无数次。
 */
export function CrashDialog(): React.JSX.Element {
  const { t } = useTranslation()
  const current = useCrashStore((s) => s.current)
  const dismiss = useCrashStore((s) => s.dismiss)

  const open = current !== null

  const onCopy = async (): Promise<void> => {
    if (!current) return
    const text = formatCrash(current)
    try {
      await navigator.clipboard.writeText(text)
      showInfo(t('crash.copied'))
    } catch (err) {
      console.error('[crash-dialog] clipboard write failed:', err)
    }
  }

  const onOpenLogs = (): void => {
    void window.api.logs.openFolder()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && dismiss()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex w-[640px] max-w-[90vw] flex-col rounded-sm border border-rec/40 bg-bg-panel shadow-2xl',
            'focus:outline-none'
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="flex items-center gap-2 text-xs text-fg">
              <AlertTriangle size={13} className="text-rec" />
              {t('crash.title')}
            </Dialog.Title>
            <Dialog.Close
              className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
              aria-label={t('common.close')}
            >
              <X size={12} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 px-4 py-3">
            <Dialog.Description className="text-2xs text-fg-muted">
              {t('crash.description')}
            </Dialog.Description>

            {current && (
              <>
                {/* 来源 + 标题 + 消息 */}
                <div className="flex flex-col gap-1 rounded-sm border border-border bg-bg-deep px-3 py-2">
                  <div className="flex items-center gap-2 text-2xs text-fg-dim">
                    <span className="rounded-sm bg-bg-raised px-1.5 py-0.5 font-mono uppercase">
                      {current.source}
                    </span>
                    <span className="font-mono">{current.title}</span>
                    <span className="ml-auto font-mono text-fg-dim">
                      {formatTime(current.timestamp)}
                    </span>
                  </div>
                  <div className="text-xs text-fg">{current.message}</div>
                </div>

                {/* 堆栈：只读、可滚 */}
                {current.stack && (
                  <div className="rounded-sm border border-border bg-bg-deep">
                    <div className="border-b border-border-subtle px-3 py-1 text-2xs uppercase tracking-wider text-fg-dim">
                      {t('crash.stack_label')}
                    </div>
                    <pre
                      className={cn(
                        'max-h-64 overflow-auto whitespace-pre px-3 py-2',
                        'font-mono text-2xs leading-5 text-fg-muted'
                      )}
                    >
                      {current.stack}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">
            <button
              onClick={onOpenLogs}
              className={cn(
                'flex h-6 items-center gap-1 rounded-sm border border-border bg-bg-raised px-3 text-2xs text-fg',
                'hover:border-border-strong hover:bg-chrome-hover'
              )}
            >
              <FolderOpen size={11} />
              {t('crash.open_logs_btn')}
            </button>
            <button
              onClick={onCopy}
              className={cn(
                'flex h-6 items-center gap-1 rounded-sm border border-border bg-bg-raised px-3 text-2xs text-fg',
                'hover:border-border-strong hover:bg-chrome-hover'
              )}
            >
              <Copy size={11} />
              {t('crash.copy_btn')}
            </button>
            <button
              onClick={dismiss}
              className={cn(
                'h-6 rounded-sm border border-accent bg-accent px-3 text-2xs text-white',
                'hover:bg-accent/90'
              )}
            >
              {t('common.close')}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatCrash(c: {
  source: string
  title: string
  message: string
  stack?: string
  timestamp: string
}): string {
  const lines = [`[${c.timestamp}] ${c.source}/${c.title}`, c.message, '']
  if (c.stack) {
    lines.push(c.stack)
  }
  return lines.join('\n')
}

function formatTime(iso: string): string {
  // 截掉毫秒和时区，简短可读
  return iso.replace('T', ' ').replace(/\..*$/, '')
}
