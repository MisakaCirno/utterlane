import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { computePeaks, loadSamples } from '@renderer/services/waveform'

/**
 * 当前选中 Take 的波形显示。
 *
 * 渲染：Canvas 2D，沿 x 轴每像素取一桶 peak，垂直绘制关于中轴对称的竖线。
 * 未录制 / 加载失败时退化成占位文案，布局高度保持不变。
 *
 * DPR-aware：按 devicePixelRatio 放大 canvas 的 bitmap 尺寸，避免高分屏下模糊。
 * ResizeObserver 监听容器宽度变化重绘——dockview 拖动改面板大小时跟着走。
 *
 * 波形绘制依赖：
 *   - samples（异步解码）：filePath 变化时重新拉
 *   - 容器尺寸：ResizeObserver
 *   - 颜色：来自 CSS 变量读取一次（避免硬编码）
 */
type LoadResult = { path: string; samples: Float32Array } | { path: string; errorMessage: string }

export function WaveformView({ filePath }: { filePath: string | null }): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  /**
   * 保存「最后一次成功 / 失败加载」的结果和所属 path。
   * 渲染态（loading / samples / error）全部从 filePath 和 result.path 推导，
   * 避免在 effect 里做同步 setState（被 react-hooks/set-state-in-effect 规则禁止）。
   */
  const [result, setResult] = useState<LoadResult | null>(null)

  useEffect(() => {
    if (!filePath) return
    let cancelled = false
    loadSamples(filePath)
      .then((entry) => {
        if (!cancelled) setResult({ path: filePath, samples: entry.samples })
      })
      .catch((err: Error) => {
        if (!cancelled) setResult({ path: filePath, errorMessage: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [filePath])

  // 把结果与当前 filePath 匹配后再派生视图状态——
  // 避免「刚切段时 result 还指向旧段」把旧波形短暂地显示出来
  const matches = result && result.path === filePath
  const samples = matches && 'samples' in result ? result.samples : null
  const errorMessage = matches && 'errorMessage' in result ? result.errorMessage : null
  const loading = filePath !== null && !matches

  // samples 或容器尺寸变化 → 重绘
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

      // 一个像素一个桶，足够细致又避免采样不足的锯齿
      const buckets = Math.max(1, Math.floor(rect.width))
      const peaks = computePeaks(samples, buckets)
      const midY = rect.height / 2
      // 给上下各留 4px 余量，避免削波时波形顶到边
      const maxHalfHeight = midY - 4

      // 用产品品牌色（Tailwind 里 accent.DEFAULT）硬编码——
      // 波形是产品识别的一部分，不跟随 dock 主题切换
      ctx.strokeStyle = '#0e639c'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 0; x < buckets; x++) {
        const peak = peaks[x]
        const h = peak * maxHalfHeight
        // +0.5 对齐像素网格，避免 1px 线糊成 2px
        const px = x + 0.5
        ctx.moveTo(px, midY - h)
        ctx.lineTo(px, midY + h)
      }
      ctx.stroke()

      // 中轴细线作为零电平参考
      ctx.strokeStyle = 'rgba(204,204,204,0.15)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, midY)
      ctx.lineTo(rect.width, midY)
      ctx.stroke()
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(container)
    return () => ro.disconnect()
  }, [samples])

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
