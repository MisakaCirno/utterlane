import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { subscribeLevel as subscribeRecorderLevel } from '@renderer/services/recorder'
import { subscribeLevel as subscribePlayerLevel } from '@renderer/services/player'
import { amplitudeToDb, dbToFill, formatDb, LEVEL_DB_FLOOR } from '@renderer/lib/audio'

/**
 * 电平表视图：显示「当前正在产生声音的源」的实时电平。
 *
 * 数据来源：同时订阅 recorder + player 的电平事件。
 *   - 录音中：recorder 每个 audio buffer 推一次 RMS
 *   - 播放中：player 的 AnalyserNode 每帧推一次 RMS
 *   - 空闲：两个都不发；结束时各自会发一个 0 让条归零
 *
 * 显示：
 *   - 主条：底部到 fillRatio 的彩色填充。色带本身是绿→黄→红的连续渐变，
 *     mask 只露出当前 fill 之下的部分——用户的视觉感受是「条往上长，
 *     越接近顶部越接近削波」
 *   - 数值：dBFS（数字满刻度）。voice 通常落在 -30 ~ -10 dB；越接近 0 越响
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

  const db = amplitudeToDb(level)
  const fillRatio = dbToFill(db)

  return (
    <div className="flex h-full flex-col items-center gap-2 bg-bg px-3 py-3">
      <div className="text-2xs text-fg-muted">{t('level_meter.title')}</div>
      <div className="relative w-5 flex-1 overflow-hidden rounded-sm border border-border bg-bg-deep">
        {/*
          色带打底：绿 → 黄 → 红的连续渐变。位置约定：底部 = -60 dBFS（floor），
          顶部 = 0 dBFS。70% 位置 ≈ -18 dB（关注线）、90% 位置 ≈ -6 dB（红色）。
          这些百分比与 dbToFill 的隐含映射一致——floor=-60、ceil=0 时
          70% / 90% 反算回 dB 即 -18 / -6
        */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, rgb(34 197 94) 0%, rgb(34 197 94) 60%, rgb(234 179 8) 75%, rgb(234 179 8) 85%, rgb(239 68 68) 95%)'
          }}
        />
        {/*
          反向遮罩：从顶部往下盖到「当前 fill」之上的所有区域，把色带露出
          底部那一段。transition 给 75ms 让条平滑而不抖动
        */}
        <div
          className="absolute left-0 right-0 top-0 bg-bg-deep transition-[height] duration-75"
          style={{ height: `${(1 - fillRatio) * 100}%` }}
        />
        {/* 关注线：-18 dB（≈ 70%）拉一根细线，提示用户「这条线之下是健康响度」 */}
        <div
          className="pointer-events-none absolute left-0 right-0 border-t border-fg-dim/30"
          style={{ bottom: `${dbToFill(-18) * 100}%` }}
        />
      </div>
      <div className="font-mono text-2xs tabular-nums text-fg-dim">{formatDb(db)}</div>
      <div className="font-mono text-[9px] tabular-nums text-fg-dim/60">
        {LEVEL_DB_FLOOR} … 0 dBFS
      </div>
    </div>
  )
}
