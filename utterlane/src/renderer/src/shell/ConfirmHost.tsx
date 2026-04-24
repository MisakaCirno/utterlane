import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { AlertTriangle } from 'lucide-react'
import { useConfirmStore } from '@renderer/store/confirmStore'
import { cn } from '@renderer/lib/cn'

/**
 * 渲染全局确认对话框的宿主组件。挂在 App 根一次。
 *
 * 订阅 useConfirmStore.pending：
 *   - pending != null → open
 *   - onOpenChange(false) → resolve(false)（外部点遮罩 / Esc 关闭视作取消）
 *   - 点「确认」→ resolve(true)
 *
 * danger 语气换红边 + 红色确认按钮（常用于删除 / 丢弃这类不可逆操作）。
 */
export function ConfirmHost(): React.JSX.Element {
  const pending = useConfirmStore((s) => s.pending)
  const resolve = useConfirmStore((s) => s.resolve)

  const open = pending !== null

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) resolve(false)
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex w-[420px] max-w-[90vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
            pending?.tone === 'danger' && 'border-rec/40',
            'focus:outline-none'
          )}
        >
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            {pending?.tone === 'danger' && (
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rec" />
            )}
            <div className="flex-1">
              <AlertDialog.Title className="text-xs text-fg">
                {pending?.title ?? ''}
              </AlertDialog.Title>
              {pending?.description && (
                <AlertDialog.Description className="mt-1 whitespace-pre-wrap text-2xs text-fg-muted">
                  {pending.description}
                </AlertDialog.Description>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-2">
            <AlertDialog.Cancel
              onClick={() => resolve(false)}
              className={cn(
                'h-6 rounded-sm border border-border bg-bg-raised px-3 text-2xs text-fg',
                'hover:border-border-strong hover:bg-chrome-hover'
              )}
            >
              {pending?.cancelLabel ?? '取消'}
            </AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => resolve(true)}
              className={cn(
                'h-6 rounded-sm border px-3 text-2xs text-white',
                pending?.tone === 'danger'
                  ? 'border-rec bg-rec hover:bg-rec/90'
                  : 'border-accent bg-accent hover:bg-accent/90'
              )}
            >
              {pending?.confirmLabel ?? '确认'}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
