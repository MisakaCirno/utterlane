import { cn } from '@renderer/lib/cn'

/**
 * 时间标尺。横向渲染时间刻度 + 标签。在 ProjectTimeline 与 SegmentTimeline
 * 的 WaveformView 之间共享。
 *
 * === Tick 间隔 ===
 *
 * 间隔从 TICK_CANDIDATES_MS 里挑：选「主刻度落在 ≥ MIN_TICK_PX 像素」的
 * 最小档位。这样高缩放下 tick 自动加密、低缩放下自动稀释，标签互不重叠。
 *
 * === 标签格式 ===
 *
 * 当 tick 间隔 < 1s 时改用「秒.十分位」（不到 1 分钟）或「mm:ss.f」（≥ 1
 * 分钟）格式——传统 mm:ss 在 200ms / 500ms 间隔下相邻 tick 都是同一秒数，
 * 用户分不清「这一格代表多长时间」。
 *
 * === 虚拟化 ===
 *
 * 长时间轴下渲染所有 tick 浪费：3000 个 div 一次性挂上去，缩放 / 滚动都是
 * 大量 DOM diff。若调用方传入 scrollLeft + viewportWidth，则只渲染当前可
 * 视区域 + 左右各 4 个 tick 的 overscan；否则（短内容如 take 波形）退回
 * 「全渲染」更简单。
 */

const MIN_TICK_PX = 80
const OVERSCAN_TICKS = 4

const TICK_CANDIDATES_MS = [
  50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000
]

function pickTickInterval(pxPerMs: number): number {
  for (const ms of TICK_CANDIDATES_MS) {
    if (ms * pxPerMs >= MIN_TICK_PX) return ms
  }
  return TICK_CANDIDATES_MS[TICK_CANDIDATES_MS.length - 1]
}

/** mm:ss / mm:ss.f / s.f — 跟 tick 间隔耦合，避免亚秒间隔下整列「00:00」 */
function formatRulerLabel(ms: number, intervalMs: number): string {
  const sec = ms / 1000
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  if (intervalMs < 1000) {
    // 亚秒间隔：保留一位小数才能区分相邻 tick
    if (m > 0) {
      // 1 分钟以上：mm:ss.f（ss 段保留两位整数 + 一位小数 = 4 字符）
      return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
    }
    return `${s.toFixed(1)}s`
  }
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s)).padStart(2, '0')}`
}

export function TimeRuler({
  pxPerMs,
  contentWidthPx,
  scrollLeft,
  viewportWidth,
  height = 24,
  onClick,
  clickable = false,
  className
}: {
  pxPerMs: number
  contentWidthPx: number
  /** 当前横向滚动偏移。与 viewportWidth 一同提供时启用虚拟化 */
  scrollLeft?: number
  /** 视口宽度。未提供时全量渲染（短内容场景） */
  viewportWidth?: number
  /** ruler 自身高度，默认 24px */
  height?: number
  /** 点击 ruler 的回调（如 seek）。不传则 ruler 不响应点击 */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  /** 视觉上是否提示「可点」（cursor: pointer）。语义独立于 onClick——播放
      期间可能想保留 onClick 走逻辑但不显示 pointer 光标 */
  clickable?: boolean
  className?: string
}): React.JSX.Element {
  const tickIntervalMs = pickTickInterval(pxPerMs)
  const tickPx = tickIntervalMs * pxPerMs
  const maxTick = Math.max(0, Math.ceil(contentWidthPx / tickPx))

  // 虚拟化：scrollLeft + viewportWidth 都给了才启用。否则退到全量渲染
  const virtualize = scrollLeft !== undefined && viewportWidth !== undefined && viewportWidth > 0
  const startTick = virtualize ? Math.max(0, Math.floor(scrollLeft / tickPx) - OVERSCAN_TICKS) : 0
  const endTick = virtualize
    ? Math.min(maxTick, Math.ceil((scrollLeft + viewportWidth) / tickPx) + OVERSCAN_TICKS)
    : maxTick

  const ticks: React.JSX.Element[] = []
  for (let i = startTick; i < endTick; i++) {
    ticks.push(
      <div
        key={i}
        style={{ position: 'absolute', left: i * tickPx, width: tickPx }}
        className="flex h-full items-end border-r border-border-subtle pb-0.5 pl-1 font-mono text-[9px] text-fg-dim"
      >
        {formatRulerLabel(i * tickIntervalMs, tickIntervalMs)}
      </div>
    )
  }

  return (
    <div
      onClick={onClick}
      style={{ width: contentWidthPx, height }}
      className={cn(
        'relative shrink-0 border-b border-border bg-bg-deep select-none',
        clickable ? 'cursor-pointer' : 'cursor-default',
        className
      )}
    >
      {/* overflow-hidden 兜底：endTick 算多了一两个 tick 越界时不让绝对定位
          子元素影响外层 scrollerRef 的 scrollWidth */}
      <div className="relative h-full overflow-hidden" style={{ width: contentWidthPx }}>
        {ticks}
      </div>
    </div>
  )
}
