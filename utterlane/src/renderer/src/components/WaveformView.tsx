import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { computePeaks, loadSamples } from '@renderer/services/waveform'
import { subscribePosition } from '@renderer/services/player'
import { TimeRuler } from '@renderer/components/TimeRuler'

/** 顶部时间标尺高度。drawing useEffect 用它从 size.h 里扣掉，得出 canvas 实际高度 */
const RULER_H = 20

/**
 * 当前选中 Take 的波形显示。
 *
 * 渲染：Canvas 2D，沿 x 轴每像素取一桶 peak，垂直绘制关于中轴对称的竖线。
 * 未录制 / 加载失败时退化成占位文案，布局高度保持不变。
 *
 * DPR-aware：按 devicePixelRatio 放大 canvas 的 bitmap 尺寸，避免高分屏下模糊。
 * ResizeObserver 监听容器宽度变化重绘——dockview 拖动改面板大小时跟着走。
 *
 * 播放游标：订阅 player.subscribePosition，当事件里的 playingPath 正好是自己
 * 显示的 filePath 时，在另一层 canvas 上画一条垂直线代表播放头位置——
 * 用独立 canvas 而非合并到波形那层，避免每帧 60Hz 的 playhead 更新触发
 * computePeaks（O(samples)）重算波形。
 *
 * sampleRate 来自 AudioContext.decodeAudioData：decodeAudioData 会把 PCM
 * 重采到 AudioContext 的 sampleRate（一般等于设备 sampleRate），所以波形
 * 上采样数 / 该 rate 算出的「时长」与 audio.duration 一致——playheadMs
 * 映射到 canvas x 坐标时这两边自然对得上。原始文件的 sample rate 在这里
 * 不需要也不可见。
 *
 * === Trim 编辑（可选） ===
 *
 * 若调用方传入 durationMs + onTrimChange，则在波形两端渲染可拖拽手柄：
 * 用户拖动左 / 右手柄设置节选起 / 终点。手柄外的区域以半透明遮罩覆盖，
 * 视觉上区分「保留段」与「裁掉段」。trim === undefined 时手柄默认贴边
 * （0 / durationMs），用户拖动后自动激活节选
 */

type LoadResult = { path: string; samples: Float32Array } | { path: string; errorMessage: string }

type CacheEntry = { samples: Float32Array; sampleRate: number }

/** 拖拽节选手柄时的最小区间长度（毫秒），防止两个手柄重叠成 0 长度区间 */
const MIN_TRIM_SPAN_MS = 50

export type WaveformTrim = { startMs: number; endMs: number }

export function WaveformView({
  filePath,
  durationMs,
  trim,
  onTrimChange,
  zoomH = 1,
  zoomV = 1,
  onWheel
}: {
  filePath: string | null
  /**
   * Take 总时长，用于 trim 手柄的 px ↔ ms 换算。波形 canvas 自身用解码
   * 后的 samples.length / sampleRate 得到时长（理论上一致）；这里多传
   * 一份是因为 trim 编辑可能在 samples 还没加载完时就要响应
   */
  durationMs?: number
  trim?: WaveformTrim
  /**
   * 节选变更回调。undefined → 用户清空 trim（手柄拖回两端）；
   * 否则传新区间。仅当传了这个 prop 时才显示手柄
   */
  onTrimChange?: (trim: WaveformTrim | undefined) => void
  /**
   * 横向缩放。1 = canvas 宽度等于容器宽度（无横向滚动）；> 1 = canvas
   * 比容器宽，外层 scroll container 出横向滚动条供精细调整 trim
   */
  zoomH?: number
  /**
   * 纵向缩放。1 = 默认振幅；> 1 = 振幅放大显示（低音量录音也看得清）；
   * < 1 = 振幅压低。波形超出容器高度时自然被 overflow 裁
   */
  zoomV?: number
  /**
   * 容器层 wheel 事件回调。让父级实现「Ctrl+wheel = 缩放、普通 wheel =
   * 横向滚动」之类的策略。WaveformView 自己不处理 wheel
   */
  onWheel?: (e: WheelEvent) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const waveCanvasRef = useRef<HTMLCanvasElement>(null)
  // 游标改成命令式 1px 竖线（ref + transform），见下方 effect。
  // 之前用 canvas + setPlayheadMs 触发整个组件重渲染 + canvas redraw，
  // 60Hz 跑下来有 React reconciliation + canvas API 双重开销
  const playheadRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<LoadResult | null>(null)
  // 缓存 sampleRate 用于把 playheadMs 换算到 canvas x 坐标。
  // 独立于 result.samples 的状态——只在加载成功时一起设置。
  const [entry, setEntry] = useState<CacheEntry | null>(null)
  // 容器尺寸——影响波形 / trim 手柄定位
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  // 横向滚动偏移：传给 TimeRuler 用于 tick 虚拟化（zoomH=1 时一直是 0）
  const [scrollLeft, setScrollLeft] = useState(0)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    loadSamples(filePath)
      .then((cacheEntry) => {
        if (!cancelled) {
          setResult({ path: filePath, samples: cacheEntry.samples })
          setEntry(cacheEntry)
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setResult({ path: filePath, errorMessage: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  const matches = result && result.path === filePath
  const samples = matches && 'samples' in result ? result.samples : null
  const errorMessage = matches && 'errorMessage' in result ? result.errorMessage : null
  const loading = filePath !== null && !matches

  // 总时长（毫秒），用于把 playheadMs 映射到 x 坐标。
  // durationMs（来自 Take 元数据）在 samples 解码完成前就可用，可以提前
  // 让 ruler 渲染——纯显示用 ruler 拿不到真实采样精度也没关系
  const totalMs = samples && entry ? (samples.length / entry.sampleRate) * 1000 : (durationMs ?? 0)

  // === 缩放后的内层宽度 ===
  // size.w 是外层 scroll container 的可见宽度（viewport）。inner 内容
  // 宽度 = viewport × zoomH。zoomH=1 时 inner = viewport（无横向滚动），
  // zoomH>1 时 inner 比 viewport 宽，外层 overflow-x-auto 出滚动条。
  // 所有 absolute 子元素（canvas / handles / overlays / playhead）的位置
  // 都基于 innerWidth，而不是 size.w
  const innerWidth = size.w > 0 ? size.w * zoomH : 0

  // 命令式更新游标：subscribePosition 回调里直接写 transform，不走 React。
  // closure 捕获 filePath / totalMs / innerWidth，任意变化时重新订阅以
  // 让 closure 拿到最新值
  useEffect(() => {
    const target = playheadRef.current
    if (!target) return
    if (innerWidth === 0 || totalMs <= 0) {
      target.style.display = 'none'
      return
    }
    return subscribePosition((playingPath, positionMs) => {
      const el = playheadRef.current
      if (!el) return
      // 只在 segment 播放语境下显示 playhead——project 连读时游标反馈
      // 归 ProjectTimeline 管,WaveformView 不再「反向联动」project 播放
      // 位置(那会让用户以为「单段在播」而其实是项目连读)
      const playback = useEditorStore.getState().playback
      if (playback !== 'segment') {
        el.style.display = 'none'
        return
      }
      if (!playingPath || playingPath !== filePath) {
        el.style.display = 'none'
        return
      }
      const ratio = Math.min(1, Math.max(0, positionMs / totalMs))
      const cx = ratio * innerWidth
      el.style.display = 'block'
      el.style.transform = `translate3d(${cx}px, 0, 0)`
    })
  }, [filePath, totalMs, innerWidth])

  // 容器尺寸跟踪：用 ResizeObserver 写到 size state，让两层 canvas 都依赖
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = (): void => {
      const rect = container.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  // 是否显示 ruler：必须有有效时长 + 已知 inner 宽度。两者缺一就回退到
  // 「波形铺满容器」的旧布局（避免 ruler 渲染了但内部一片空白）
  const showRuler = totalMs > 0 && innerWidth > 0
  // 波形 canvas 的实际可用高度：ruler 显示时从容器扣掉 ruler 自己那
  // 部分，否则就是整个容器高度
  const waveH = showRuler ? Math.max(0, size.h - RULER_H) : size.h

  // 波形层：依赖 samples + innerWidth + waveH + zoomV。innerWidth 已经
  // 包含 zoomH 因素；zoomV 影响绘制时的振幅高度
  useEffect(() => {
    const canvas = waveCanvasRef.current
    if (!canvas || innerWidth === 0 || waveH === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(innerWidth * dpr)
    canvas.height = Math.floor(waveH * dpr)
    canvas.style.width = `${innerWidth}px`
    canvas.style.height = `${waveH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, innerWidth, waveH)

    if (!samples) return

    // buckets = innerWidth：zoomH 越大 → 越多 buckets → 波形越细。代价是
    // 重绘时间跟 buckets 成线性，但 zoomH 变化不频繁，可接受
    const buckets = Math.max(1, Math.floor(innerWidth))
    const peaks = computePeaks(samples, buckets)
    const midY = waveH / 2
    // zoomV 缩放振幅。zoomV > 1 时波形可能超出 [0, waveH]，被外层
    // overflow-y-hidden 裁——这是预期行为（用户拉高纵向缩放就是要看
    // 低音量细节，不在乎高音量峰值视觉上"出框"）
    const maxHalfHeight = (midY - 4) * zoomV

    // 用产品品牌色（Tailwind 里 accent.DEFAULT）硬编码——
    // 波形是产品识别的一部分，不跟随 dock 主题切换
    ctx.strokeStyle = '#0e639c'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0; x < buckets; x++) {
      const peak = peaks[x]
      const h = peak * maxHalfHeight
      const px = x + 0.5
      ctx.moveTo(px, midY - h)
      ctx.lineTo(px, midY + h)
    }
    ctx.stroke()

    // 零电平参考线
    ctx.strokeStyle = 'rgba(204,204,204,0.15)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, midY)
    ctx.lineTo(innerWidth, midY)
    ctx.stroke()
  }, [samples, innerWidth, waveH, zoomV])

  // ========================================================================
  // Trim 编辑：手柄 + 遮罩
  // ========================================================================

  // 当前用于 trim 渲染的有效区间。durationMs / trim 缺失时回落到「整段」，
  // 这样手柄默认贴在两端，用户从那里开始拖即可激活节选。
  // 位置基于 innerWidth：zoomH > 1 时 inner 比 viewport 宽，handles 的
  // px 位置自然跟着分散，更易精准拖拽
  const trimDurationMs = durationMs && durationMs > 0 ? durationMs : 0
  const effectiveTrimStart = Math.max(0, Math.min(trim?.startMs ?? 0, trimDurationMs))
  const effectiveTrimEnd = Math.max(0, Math.min(trim?.endMs ?? trimDurationMs, trimDurationMs))
  const showTrimUi = !!onTrimChange && trimDurationMs > 0 && innerWidth > 0
  const startX = trimDurationMs > 0 ? (effectiveTrimStart / trimDurationMs) * innerWidth : 0
  const endX = trimDurationMs > 0 ? (effectiveTrimEnd / trimDurationMs) * innerWidth : innerWidth

  // 拖拽状态：单一 ref 跨 pointermove / up 共享
  const dragRef = useRef<{
    side: 'start' | 'end'
    startClientX: number
    initialMs: number
  } | null>(null)

  function startDrag(side: 'start' | 'end', e: React.PointerEvent): void {
    if (!onTrimChange || trimDurationMs <= 0) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      side,
      startClientX: e.clientX,
      initialMs: side === 'start' ? effectiveTrimStart : effectiveTrimEnd
    }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

  function onDragMove(e: React.PointerEvent): void {
    const ctx = dragRef.current
    if (!ctx || !onTrimChange || innerWidth <= 0) return
    const dx = e.clientX - ctx.startClientX
    // dx 是屏幕像素位移，innerWidth 是 inner 总像素宽度对应 trimDurationMs。
    // zoomH > 1 时 innerWidth 更大，相同 dx 对应更小的 dMs——拖拽精度提高
    const dMs = (dx / innerWidth) * trimDurationMs
    let nextStart = effectiveTrimStart
    let nextEnd = effectiveTrimEnd
    if (ctx.side === 'start') {
      nextStart = Math.max(0, Math.min(ctx.initialMs + dMs, effectiveTrimEnd - MIN_TRIM_SPAN_MS))
    } else {
      nextEnd = Math.min(
        trimDurationMs,
        Math.max(ctx.initialMs + dMs, effectiveTrimStart + MIN_TRIM_SPAN_MS)
      )
    }
    onTrimChange({ startMs: nextStart, endMs: nextEnd })
  }

  function endDrag(e: React.PointerEvent): void {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

  // wheel listener 用 native event 而不是 React 的 onWheel：React onWheel
  // 默认 passive: true 不能 preventDefault，会让父级 wheel 处理与默认
  // 滚动行为冲突
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onWheel) return
    const handler = (e: WheelEvent): void => onWheel(e)
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [onWheel])

  // ruler 用 px/ms = innerWidth / totalMs（仅在 showRuler 时取值才有意义）。
  // 与 player.ts 的时间单位（毫秒）保持一致
  const rulerPxPerMs = showRuler ? innerWidth / totalMs : 0

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
      className={cn(
        // overflow-x-auto 让 zoomH > 1 时出现横向滚动条；overflow-y-hidden
        // 防止 zoomV > 1 时波形纵向溢出导致的纵向滚动（纵向方向用户没法
        // 滚动也无意义）
        'relative flex-1 overflow-x-auto overflow-y-hidden bg-bg-deep',
        // 最小高度保证切空段时布局不坍塌；提到 100px 给 ruler + 波形
        // 各自留出可用空间
        'min-h-[100px]'
      )}
    >
      {!filePath && <Placeholder>{t('timeline.waveform_unrecorded')}</Placeholder>}
      {filePath && loading && <Placeholder>{t('timeline.waveform_loading')}</Placeholder>}
      {filePath && errorMessage && (
        <Placeholder>{t('timeline.waveform_error', { message: errorMessage })}</Placeholder>
      )}
      {filePath && !errorMessage && (
        // inner 容器：flex column 把 ruler 与波形区垂直排开。宽度 =
        // innerWidth（=viewport×zoomH），absolute 子元素都以波形区为
        // 定位基准。container 是 scroll outer，inner 超出 viewport 部分
        // 由 outer 的 overflow-x-auto 接管成横向滚动条
        <div className="flex h-full flex-col" style={{ width: innerWidth || '100%' }}>
          {showRuler && (
            <TimeRuler
              pxPerMs={rulerPxPerMs}
              contentWidthPx={innerWidth}
              scrollLeft={scrollLeft}
              viewportWidth={size.w}
              height={RULER_H}
            />
          )}
          {/* 波形区：absolute 子元素的定位基准，flex-1 吃掉 ruler 之外的
              所有高度 */}
          <div className="relative flex-1">
            <canvas ref={waveCanvasRef} className="absolute top-0 left-0" />
            {/* 节选 trim 遮罩：手柄外的区域用半透明黑覆盖，视觉上提示
                「这段不会被播放 / 导出」。pointer-events-none 不挡 click /
                hover */}
            {showTrimUi && startX > 0 && (
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 left-0 bg-bg-deep/70"
                style={{ width: startX }}
              />
            )}
            {showTrimUi && endX < innerWidth && (
              <div
                aria-hidden
                className="pointer-events-none absolute top-0 bottom-0 bg-bg-deep/70"
                style={{ left: endX, width: innerWidth - endX }}
              />
            )}
            {/* 播放游标:Adobe Pr 风格——1px 竖线 + 顶部三角 marker,
                单一 accent 色,不再用红色区分播放态(整个 app 统一用
                同一种 playhead 视觉)。位置由命令式 useEffect 写 transform,
                不走 React 重渲染。z 叠在波形之上、trim 手柄之下;
                初始 display: none,subscribePosition 命中本 take 时才显示 */}
            <div
              ref={playheadRef}
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-px bg-accent will-change-transform"
              style={{ display: 'none' }}
            >
              <div
                className="absolute -left-[5px] top-0 h-2 w-[11px] bg-accent"
                style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
              />
            </div>
            {/* trim 手柄：只在传入 onTrimChange 且 innerWidth > 0 时渲染 */}
            {showTrimUi && (
              <>
                <TrimHandle
                  side="start"
                  x={startX}
                  title={t('timeline.trim_start_handle')}
                  onPointerDown={(e) => startDrag('start', e)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
                <TrimHandle
                  side="end"
                  x={endX}
                  title={t('timeline.trim_end_handle')}
                  onPointerDown={(e) => startDrag('end', e)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 节选手柄。竖线 + 顶 / 底各一个小方块作为视觉抓手。
 * 真正可拖拽的是宽 8px 的透明热区，让手柄即便在波形密集时也好抓
 */
function TrimHandle({
  side,
  x,
  title,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: {
  side: 'start' | 'end'
  x: number
  title: string
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
}): React.JSX.Element {
  return (
    <div
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        'absolute top-0 bottom-0 z-30 flex w-2 cursor-ew-resize items-stretch justify-center',
        side === 'start' ? '-translate-x-1/2' : '-translate-x-1/2'
      )}
      style={{ left: x }}
    >
      {/* 视觉竖线 + 顶/底抓手 */}
      <div className="relative h-full w-px bg-accent">
        <div
          className={cn(
            'absolute h-2 w-2 -translate-x-1/2 bg-accent',
            side === 'start' ? 'top-0 rounded-br-sm' : 'top-0 rounded-bl-sm'
          )}
        />
        <div
          className={cn(
            'absolute bottom-0 h-2 w-2 -translate-x-1/2 bg-accent',
            side === 'start' ? 'rounded-tr-sm' : 'rounded-tl-sm'
          )}
        />
      </div>
    </div>
  )
}

function Placeholder({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center text-2xs text-fg-dim">
      {children}
    </div>
  )
}
