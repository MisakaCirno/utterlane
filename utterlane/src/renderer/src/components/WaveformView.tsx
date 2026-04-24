import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { computePeaks, loadSamples } from '@renderer/services/waveform'
import { subscribePosition } from '@renderer/services/player'

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
 * 显示的 filePath 时，在 canvas 上叠一条垂直线代表播放头位置。
 */

type LoadResult = { path: string; samples: Float32Array } | { path: string; errorMessage: string }

type CacheEntry = { samples: Float32Array; sampleRate: number }

export function WaveformView({ filePath }: { filePath: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<LoadResult | null>(null)
  // 缓存 sampleRate 用于把 playheadMs 换算到 canvas x 坐标。
  // 独立于 result.samples 的状态——只在加载成功时一起设置。
  const [entry, setEntry] = useState<CacheEntry | null>(null)
  // playheadMs === null：当前不在播本文件；数值：播到了多少毫秒
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)

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

  // 订阅播放位置。只有当 playingPath 等于本组件显示的 filePath 时才记录 playhead。
  useEffect(() => {
    const off = subscribePosition((playingPath, positionMs) => {
      if (playingPath && playingPath === filePath) {
        setPlayheadMs(positionMs)
      } else {
        setPlayheadMs(null)
      }
    })
    return off
  }, [filePath])

  const matches = result && result.path === filePath
  const samples = matches && 'samples' in result ? result.samples : null
  const errorMessage = matches && 'errorMessage' in result ? result.errorMessage : null
  const loading = filePath !== null && !matches

  // 总时长（毫秒），用于把 playheadMs 映射到 x 坐标
  const totalMs = samples && entry ? (samples.length / entry.sampleRate) * 1000 : 0

  // 每次 samples / playheadMs / 尺寸变化都重绘
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const draw = (): void => {
      const rect = container.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(rect.width * dpr)
      canvas.height = Math.floor(rect.height * dpr)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, rect.width, rect.height)

      if (!samples) return

      const buckets = Math.max(1, Math.floor(rect.width))
      const peaks = computePeaks(samples, buckets)
      const midY = rect.height / 2
      const maxHalfHeight = midY - 4

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
      ctx.lineTo(rect.width, midY)
      ctx.stroke()

      // 播放游标：playheadMs 有值且 totalMs 可算时，画一条竖线
      if (playheadMs !== null && totalMs > 0) {
        const ratio = Math.min(1, Math.max(0, playheadMs / totalMs))
        const cx = Math.floor(ratio * rect.width) + 0.5
        // 用红色让游标在蓝色波形里视觉上分得清；不透明度给弱一点避免过度打扰
        ctx.strokeStyle = 'rgba(209, 69, 69, 0.85)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(cx, 0)
        ctx.lineTo(cx, rect.height)
        ctx.stroke()
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [samples, playheadMs, totalMs])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex-1 overflow-hidden bg-bg-deep',
        // 最小高度保证切空段时布局不坍塌
        'min-h-[80px]'
      )}
    >
      {!filePath && <Placeholder>{t('timeline.waveform_unrecorded')}</Placeholder>}
      {filePath && loading && <Placeholder>{t('timeline.waveform_loading')}</Placeholder>}
      {filePath && errorMessage && (
        <Placeholder>{t('timeline.waveform_error', { message: errorMessage })}</Placeholder>
      )}
      {filePath && !errorMessage && <canvas ref={canvasRef} />}
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
