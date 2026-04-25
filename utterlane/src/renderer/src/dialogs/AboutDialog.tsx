import * as Dialog from '@radix-ui/react-dialog'
import { Copy, Mic, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppInfo } from '@shared/appInfo'
import { showInfo } from '@renderer/store/toastStore'
import { cn } from '@renderer/lib/cn'

/**
 * About 对话框。
 *
 * 显示软件名称、版本、许可证、运行时版本（Electron / Chromium / Node）。
 * 提供「复制诊断信息」按钮，方便用户在反馈 bug 时附带版本环境。
 *
 * 信息从 main 进程拉一次后缓存（启动后不会变），不需要订阅。
 */
export function AboutDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [info, setInfo] = useState<AppInfo | null>(null)

  // 第一次打开时拉取（避免没用 About 时也跑一次 IPC）
  useEffect(() => {
    if (!open || info) return
    let cancelled = false
    void window.api.app.getInfo().then((res) => {
      if (!cancelled) setInfo(res)
    })
    return () => {
      cancelled = true
    }
  }, [open, info])

  const copyDiagnostics = async (): Promise<void> => {
    if (!info) return
    const text = [
      `${info.name} ${info.version}`,
      `Platform: ${info.platform} ${info.arch}`,
      `Electron: ${info.electron}`,
      `Chromium: ${info.chromium}`,
      `Node: ${info.node}`,
      `V8: ${info.v8}`
    ].join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showInfo(t('about.copied'))
    } catch (err) {
      // 极少数 Electron 配置下 clipboard 不可用——降级提示
      console.error('[about] clipboard write failed:', err)
    }
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
            <Dialog.Title className="text-xs text-fg">{t('about.title')}</Dialog.Title>
            <Dialog.Close
              className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
              aria-label={t('common.close')}
            >
              <X size={12} />
            </Dialog.Close>
          </div>

          <div className="flex flex-col gap-3 px-5 py-4">
            {/* 标识区：图标 + 名字 + 版本 + 一句话 */}
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-bg-raised">
                <Mic size={24} className="text-accent" />
              </div>
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="text-sm font-semibold tracking-wide text-fg">
                  {info?.name ?? t('app.title')}
                </div>
                <div className="text-2xs text-fg-muted">
                  {info ? t('about.version', { version: info.version }) : '…'}
                </div>
                <div className="text-2xs text-fg-dim">{t('app.tagline')}</div>
              </div>
            </div>

            {/* 法律 / 链接 */}
            <Dialog.Description className="text-2xs text-fg-muted">
              {t('about.license_label')}{' '}
              <ExternalLink href="https://www.mozilla.org/en-US/MPL/2.0/">MPL-2.0</ExternalLink>
              {t('about.license_suffix') ? ` ${t('about.license_suffix')}` : ''}
            </Dialog.Description>

            {/* 诊断信息：等宽小字 + 复制按钮 */}
            <div className="rounded-sm border border-border bg-bg-deep px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wider text-fg-dim">
                  {t('about.diagnostics_label')}
                </span>
                <button
                  onClick={copyDiagnostics}
                  disabled={!info}
                  className={cn(
                    'flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs text-fg-muted',
                    'hover:bg-bg-raised hover:text-fg',
                    'disabled:cursor-not-allowed disabled:opacity-40'
                  )}
                  title={t('about.copy_tooltip')}
                >
                  <Copy size={10} />
                  {t('about.copy_btn')}
                </button>
              </div>
              <pre className="overflow-x-auto whitespace-pre font-mono text-2xs leading-5 text-fg-muted">
                {info ? formatDiagnostics(info) : '…'}
              </pre>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatDiagnostics(info: AppInfo): string {
  // 对齐成两列：右边写值，左边一致宽度的标签
  const rows: Array<[string, string]> = [
    ['Platform', `${info.platform} ${info.arch}`],
    ['Electron', info.electron],
    ['Chromium', info.chromium],
    ['Node', info.node],
    ['V8', info.v8]
  ]
  const labelWidth = Math.max(...rows.map(([k]) => k.length))
  return rows.map(([k, v]) => `${k.padEnd(labelWidth)}  ${v}`).join('\n')
}

function ExternalLink({
  href,
  children
}: {
  href: string
  children: React.ReactNode
}): React.JSX.Element {
  // electron 默认拦截 target=_blank 走 setWindowOpenHandler，会用系统浏览器打开
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  )
}
