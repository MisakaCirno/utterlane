import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { subscribeLevel as subscribeRecorderLevel } from '@renderer/services/recorder'
import { subscribeLevel as subscribePlayerLevel } from '@renderer/services/player'

/**
 * 电平表视图：显示「当前正在产生声音的源」的实时电平。
 *
 * 数据来源：同时订阅 recorder + player 的电平事件。
 *   - 录音中：recorder 每个 audio buffer 推一次 RMS
 *   - 播放中：player 的 AnalyserNode 每帧推一次 RMS
 *   - 空闲：两个都不发；结束时各自会发一个 0 让条归零
 *
 * UI：垂直条 + 顶部数字标注（当前 RMS * 2 的百分比，和条宽一致的视觉约定）。
 * 分色段：绿 / 黄 / 红对应正常 / 较响 / 临近削波，帮用户判断录音音量是否合适。
 *
 * RAF 合并：recorder 每 ~20ms 推一次，player 每帧推一次。用 requestAnimationFrame
 * 把多次 push 合并到同一帧里 setState 一次，避免 React 过度重绘。
 */
export function LevelMeterView(): React.JSX.Element {
  const { t } = useTranslation()
  const [level, setLevel] = useState(0)

  useEffect(() => {
    let pending = 0
    let rafId: number | null = null
    const flush = (): void => {
      rafId = null
      setLevel(pending)
    }
    const onLevel = (l: number): void => {
      pending = l
      if (rafId === null) rafId = requestAnimationFrame(flush)
    }
    const off1 = subscribeRecorderLevel(onLevel)
    const off2 = subscribePlayerLevel(onLevel)
    return () => {
      off1()
      off2()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  // 视觉放大：一般讲话 RMS 0.05~0.2，* 2 让条在日常讲话时有明显读数
  const scaled = Math.min(1, level * 2)
  const percent = Math.round(scaled * 100)

  return (
    <div className="flex h-full flex-col items-center gap-2 bg-bg px-3 py-3">
      <div className="text-2xs text-fg-muted">{t('level_meter.title')}</div>
      <div className="relative flex-1 w-5 overflow-hidden rounded-sm border border-border bg-bg-deep">
        {/* 分段色带（底到顶）——通过绝对定位的条堆叠；meter fill 在最上遮住超出部分 */}
        <GradientSegment from="0%" to="60%" className="bg-ok/70" />
        <GradientSegment from="60%" to="85%" className="bg-yellow-500/70" />
        <GradientSegment from="85%" to="100%" className="bg-rec/70" />
        {/* 反向遮罩：从顶部往下盖到「当前 level」以上的部分，把色段藏起来 */}
        <div
          className="absolute left-0 right-0 top-0 bg-bg-deep transition-[height] duration-75"
          style={{ height: `${100 - percent}%` }}
        />
      </div>
      <div className="font-mono text-2xs tabular-nums text-fg-dim">{percent}%</div>
    </div>
  )
}

/**
 * 一段色带：from / to 是距底部的百分比位置。
 * 绝对定位，底部对齐。
 */
function GradientSegment({
  from,
  to,
  className
}: {
  from: string
  to: string
  className: string
}): React.JSX.Element {
  return (
    <div
      className={cn('absolute left-0 right-0', className)}
      style={{ bottom: from, height: `calc(${to} - ${from})` }}
    />
  )
}
