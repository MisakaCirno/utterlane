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
 * 显示的 filePath 时，在另一层 canvas 上画一条垂直线代表播放头位置——
 * 用独立 canvas 而非合并到波形那层，避免每帧 60Hz 的 playhead 更新触发
 * computePeaks（O(samples)）重算波形。
 *
 * sampleRate 来自 AudioContext.decodeAudioData：decodeAudioData 会把 PCM
 * 重采到 AudioContext 的 sampleRate（一般等于设备 sampleRate），所以波形
 * 上采样数 / 该 rate 算出的「时长」与 audio.duration 一致——playheadMs
 * 映射到 canvas x 坐标时这两边自然对得上。原始文件的 sample rate 在这里
 * 不需要也不可见。
 */

type LoadResult = { path: string; samples: Float32Array } | { path: string; errorMessage: string }

type CacheEntry = { samples: Float32Array; sampleRate: number }

export function WaveformView({ filePath }: { filePath: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  const waveCanvasRef = useRef<HTMLCanvasElement>(null)
  const playheadCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<LoadResult | null>(null)
  // 缓存 sampleRate 用于把 playheadMs 换算到 canvas x 坐标。
  // 独立于 result.samples 的状态——只在加载成功时一起设置。
  const [entry, setEntry] = useState<CacheEntry | null>(null)
  // playheadMs === null：当前不在播本文件；数值：播到了多少毫秒
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)
  // 容器尺寸——同时影响波形与游标层，单独跟踪让两条 effect 都能依赖
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

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

  // 波形层：仅依赖 samples + size。播放每帧的 playheadMs 变化不会让它重绘，
  // 不再触发 computePeaks(O(samples)) 的浪费。
  useEffect(() => {
    const canvas = waveCanvasRef.current
    if (!canvas || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(size.w * dpr)
    canvas.height = Math.floor(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.w, size.h)

    if (!samples) return

    const buckets = Math.max(1, Math.floor(size.w))
    const peaks = computePeaks(samples, buckets)
    const midY = size.h / 2
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
    ctx.lineTo(size.w, midY)
    ctx.stroke()
  }, [samples, size])

  // 游标层：仅依赖 playheadMs + totalMs + size。绝对定位覆盖在波形上方，
  // 每帧只清一次小区域 + 画一条竖线，O(1)
  useEffect(() => {
    const canvas = playheadCanvasRef.current
    if (!canvas || size.w === 0 || size.h === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(size.w * dpr)
    canvas.height = Math.floor(size.h * dpr)
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, size.w, size.h)

    if (playheadMs === null || totalMs <= 0) return
    const ratio = Math.min(1, Math.max(0, playheadMs / totalMs))
    const cx = Math.floor(ratio * size.w) + 0.5
    ctx.strokeStyle = 'rgba(209, 69, 69, 0.85)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, size.h)
    ctx.stroke()
  }, [playheadMs, totalMs, size])

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
      {filePath && !errorMessage && (
        <>
          <canvas ref={waveCanvasRef} className="absolute inset-0" />
          <canvas
            ref={playheadCanvasRef}
            className="pointer-events-none absolute inset-0"
          />
        </>
      )}
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
