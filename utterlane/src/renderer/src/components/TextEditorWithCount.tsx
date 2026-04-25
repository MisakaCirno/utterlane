import { useTranslation } from 'react-i18next'
import { type RefObject } from 'react'
import { cn } from '@renderer/lib/cn'
import type { TextAlign } from '@shared/preferences'

/**
 * 单行文案编辑框 + 右下角字数计数器。
 *
 * Inspector 和 Segment Timeline 共用同一份实现：
 *   - 单行 input：和数据不变量「Segment.text 不含换行」对齐
 *   - h-9 高度：浏览器自动垂直居中文字（line-height = height）
 *   - Enter / 换行键：preventDefault 阻止任何尝试换行的输入
 *   - blur 时 trim：编辑中允许头尾空白（让用户能正常打空格），离焦后规整
 *   - 字数计数器贴在 input 右下角外侧；超过 recommendedMaxChars 时变红色，
 *     hover 提示「文案过长，建议拆分」
 *
 * 上层组件传 inputRef 来用：拆分功能需要读 selectionStart，inline 操作菜单
 * 也可能需要程序化 focus
 */
export function TextEditorWithCount({
  value,
  onChange,
  onFocus,
  onBlur,
  inputRef,
  recommendedMaxChars,
  textAlign,
  placeholder,
  disabled
}: {
  value: string
  onChange: (next: string) => void
  onFocus?: () => void
  onBlur?: () => void
  inputRef?: RefObject<HTMLInputElement | null>
  /** 推荐最大字数；undefined / 0 = 不显示比较，仅显示当前长度 */
  recommendedMaxChars?: number
  textAlign: TextAlign
  placeholder?: string
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const len = value.length
  const limit = recommendedMaxChars && recommendedMaxChars > 0 ? recommendedMaxChars : 0
  const over = limit > 0 && len > limit

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={(e) => {
          onBlur?.()
          // 提交时 trim：编辑过程中允许头尾空白让用户正常打字，离焦后规整
          const trimmed = e.target.value.trim()
          if (trimmed !== e.target.value) onChange(trimmed)
        }}
        onKeyDown={(e) => {
          // 数据不变量：Segment.text 单行。input 已经原生不接受换行，但
          // 显式拦下 Enter 让 form / 上层快捷键也不会触发别的逻辑
          if (e.key === 'Enter') e.preventDefault()
        }}
        className={cn(
          // h-9 + leading-9 让浏览器把文字垂直居中；左右多 padding 给字数
          // 计数器留出空间避免覆盖最末字符
          'h-9 w-full rounded-sm border border-border bg-bg-deep px-2 py-0',
          'text-xs leading-9 outline-none focus:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-60',
          // 右内边距加大避免长文本撞到 counter
          limit > 0 ? 'pr-20' : 'pr-12',
          alignClassName(textAlign)
        )}
      />
      <span
        title={over ? t('text_editor.too_long_hint') : undefined}
        className={cn(
          'pointer-events-auto absolute right-2 bottom-0.5 select-none font-mono text-2xs tabular-nums',
          over ? 'text-rec' : 'text-fg-dim'
        )}
      >
        {limit > 0 ? `${len} / ${limit}` : len}
      </span>
    </div>
  )
}

function alignClassName(align: TextAlign): string {
  return align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
}
