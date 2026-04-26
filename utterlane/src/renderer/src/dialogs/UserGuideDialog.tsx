import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { cn } from '@renderer/lib/cn'

import zhUserGuide from '@renderer/docs/user-guide.zh-CN.md?raw'
import enUserGuide from '@renderer/docs/user-guide.en-US.md?raw'

/**
 * Help → 使用说明 对话框。markdown 文件随构建打包成字符串（Vite 的 ?raw
 * 后缀），用 react-markdown 渲染为 React 节点。语言跟随 i18n.language；
 * 缺译时回退到 zh-CN。
 */
export function UserGuideDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const content = i18n.language === 'en-US' ? enUserGuide : zhUserGuide

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'flex h-[640px] w-[720px] max-h-[90vh] max-w-[92vw] flex-col rounded-sm border border-border bg-bg-panel shadow-2xl',
            'focus:outline-none'
          )}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
            <Dialog.Title className="text-xs text-fg">{t('user_guide.title')}</Dialog.Title>
            <Dialog.Close
              className="rounded-sm p-1 text-fg-muted hover:bg-chrome-hover hover:text-fg"
              aria-label={t('common.close')}
            >
              <X size={12} />
            </Dialog.Close>
          </div>

          {/* markdown 内容滚动区。components 重写让默认 Tailwind 不生效的
              元素（h1 / h2 / a / code / li 等）有合适的样式 */}
          <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-fg leading-relaxed">
            <ReactMarkdown
              components={{
                h1: (p) => (
                  <h1
                    className="mb-3 mt-4 border-b border-border pb-2 text-base font-semibold text-fg first:mt-0"
                    {...p}
                  />
                ),
                h2: (p) => <h2 className="mb-2 mt-5 text-sm font-semibold text-fg" {...p} />,
                h3: (p) => <h3 className="mb-2 mt-3 text-sm font-medium text-fg" {...p} />,
                p: (p) => <p className="my-2 text-xs text-fg-muted" {...p} />,
                ul: (p) => (
                  <ul className="my-2 list-disc space-y-1 pl-5 text-xs text-fg-muted" {...p} />
                ),
                ol: (p) => (
                  <ol className="my-2 list-decimal space-y-1 pl-5 text-xs text-fg-muted" {...p} />
                ),
                li: (p) => <li className="text-xs text-fg-muted" {...p} />,
                code: (p) => (
                  <code
                    className="rounded-sm bg-bg-deep px-1 py-0.5 font-mono text-2xs text-accent"
                    {...p}
                  />
                ),
                a: ({ href, ...rest }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline-offset-2 hover:underline"
                    {...rest}
                  />
                ),
                table: (p) => (
                  <table className="my-3 w-full border-collapse text-xs text-fg-muted" {...p} />
                ),
                th: (p) => (
                  <th
                    className="border border-border bg-bg-raised px-2 py-1 text-left text-2xs font-semibold uppercase tracking-wider text-fg-dim"
                    {...p}
                  />
                ),
                td: (p) => <td className="border border-border-subtle px-2 py-1" {...p} />,
                strong: (p) => <strong className="font-semibold text-fg" {...p} />
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
