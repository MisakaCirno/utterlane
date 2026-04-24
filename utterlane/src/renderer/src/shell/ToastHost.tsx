import * as Toast from '@radix-ui/react-toast'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useToastStore, type ToastKind } from '@renderer/store/toastStore'
import { cn } from '@renderer/lib/cn'

/**
 * 渲染全局 toast 队列的宿主组件。挂在 App 根一次，订阅 toastStore 自动刷新。
 *
 * 单条 toast 默认 4 秒自动消失（可点右上角 × 提前关闭）。
 * 错误类不自动消失——让用户看到完整错误文案再手动关，
 * 避免「出错了但没来得及看清」。
 */

const KIND_TO_CONFIG: Record<
  ToastKind,
  {
    icon: React.ReactNode
    borderClass: string
    iconClass: string
    /** 0 表示不自动消失 */
    autoDismissMs: number
  }
> = {
  success: {
    icon: <CheckCircle2 size={14} />,
    borderClass: 'border-ok/40',
    iconClass: 'text-ok',
    autoDismissMs: 4000
  },
  info: {
    icon: <Info size={14} />,
    borderClass: 'border-accent/40',
    iconClass: 'text-accent',
    autoDismissMs: 4000
  },
  error: {
    icon: <XCircle size={14} />,
    borderClass: 'border-rec/40',
    iconClass: 'text-rec',
    autoDismissMs: 0
  }
}

export function ToastHost(): React.JSX.Element {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <Toast.Provider swipeDirection="right">
      {toasts.map((t) => {
        const config = KIND_TO_CONFIG[t.kind]
        return (
          <Toast.Root
            key={t.id}
            duration={config.autoDismissMs || Infinity}
            onOpenChange={(open) => {
              if (!open) dismiss(t.id)
            }}
            className={cn(
              'flex w-[360px] items-start gap-2 rounded-sm border bg-bg-panel p-3 shadow-xl',
              config.borderClass,
              'data-[state=open]:animate-in data-[state=open]:fade-in',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out'
            )}
          >
            <span className={cn('mt-0.5 shrink-0', config.iconClass)}>{config.icon}</span>
            <div className="flex-1 overflow-hidden">
              <Toast.Title className="text-xs text-fg">{t.title}</Toast.Title>
              {t.description && (
                <Toast.Description className="mt-0.5 break-words text-2xs text-fg-muted">
                  {t.description}
                </Toast.Description>
              )}
            </div>
            <Toast.Close
              className="shrink-0 rounded-sm p-0.5 text-fg-dim hover:bg-bg-raised hover:text-fg"
              aria-label="关闭"
            >
              <X size={11} />
            </Toast.Close>
          </Toast.Root>
        )
      })}
      {/* 右下角堆叠；Radix Viewport 负责无障碍焦点环管理 */}
      <Toast.Viewport className="pointer-events-none fixed bottom-8 right-4 z-[100] flex w-auto flex-col items-end gap-2 outline-none" />
    </Toast.Provider>
  )
}
