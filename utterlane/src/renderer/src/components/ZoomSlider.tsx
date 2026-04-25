import { cn } from '@renderer/lib/cn'

/**
 * 用对数刻度的滑动条做 zoom 控件，替代「缩小 / 重置 / 放大 + 数值」按钮组。
 *
 * 为什么用对数刻度：zoom 在用户感知里是「翻倍 / 减半」的关系，不是线性
 * 加减。用线性 0.1→16 这种区间，1.0 会被挤在 slider 头部一个像素宽的
 * 位置，没法精细调；改成 log(zoom) 后 0.5x 与 2x 在 slider 上分别落在
 * 1x 的左右等距位置，符合直觉。
 *
 * 重置：双击 slider 回到 1x。比单独放一个重置按钮省横向空间，配合
 * title 提示让用户能发现。
 *
 * 实现注意：
 *   - slider 内部值是离散整数（0..SLIDER_STEPS），通过 log 映射成 zoom，
 *     比直接用 step="0.01" 的 number slider 更可控
 *   - 外面给一个固定宽度的容器 + tabular-nums 数值，避免 zoom 变化时
 *     toolbar 整体宽度抖动
 */

const SLIDER_STEPS = 1000

function ratioToZoom(t: number, min: number, max: number): number {
  const logMin = Math.log(min)
  const logMax = Math.log(max)
  return Math.exp(logMin + Math.max(0, Math.min(1, t)) * (logMax - logMin))
}

function zoomToRatio(zoom: number, min: number, max: number): number {
  const logMin = Math.log(min)
  const logMax = Math.log(max)
  if (logMax === logMin) return 0
  return (Math.log(zoom) - logMin) / (logMax - logMin)
}

export function ZoomSlider({
  zoom,
  min,
  max,
  onChange,
  label,
  resetTitle,
  className
}: {
  zoom: number
  min: number
  max: number
  onChange: (next: number) => void
  /** 可选小标签（H / V），仅在多个 slider 并列时用于区分轴 */
  label?: string
  /** title 提示，告诉用户「双击回到 1x」并描述这个 slider 控制什么 */
  resetTitle: string
  className?: string
}): React.JSX.Element {
  const t = zoomToRatio(zoom, min, max)
  const sliderValue = Math.round(t * SLIDER_STEPS)

  // 数字格式：≥1 用一位小数（1.5x），<1 用两位（0.42x）——避免 1.0x 变成
  // 一长串 0，也保证小档位下精度看得见
  const display = zoom >= 1 ? zoom.toFixed(1) : zoom.toFixed(2)

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded-sm border border-border bg-bg-deep px-1.5 py-0.5',
        className
      )}
    >
      {label && <span className="font-mono text-2xs text-fg-dim">{label}</span>}
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={sliderValue}
        onChange={(e) => onChange(ratioToZoom(+e.currentTarget.value / SLIDER_STEPS, min, max))}
        onDoubleClick={() => onChange(1)}
        title={resetTitle}
        // accent-accent 让浏览器原生 range 控件 thumb / track 用主题色
        className="h-3 w-24 cursor-pointer accent-accent"
      />
      {/* 固定宽度容器避免数值变化时整条 toolbar 抖动；tabular-nums 让位数
          变化时数字宽度也保持一致 */}
      <span className="w-9 text-right font-mono text-2xs tabular-nums text-fg-dim">{display}x</span>
    </div>
  )
}
