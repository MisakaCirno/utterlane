import { useTranslation } from 'react-i18next'
import { useEditorStore } from '@renderer/store/editorStore'

/**
 * 录音前倒计时全屏遮罩。
 *
 * 仅在 playback === 'countdown' 时挂载并可见。整面屏幕半透明黑底中央
 * 一个大数字 + 「按 Esc 取消」提示。点击遮罩任意位置等同于按 Esc，
 * 让取消的发现性更高（不只 Esc 一条路径）。
 *
 * z-index 高于其他 dock / 对话框，但仍允许 ConfirmHost / ToastHost
 * 这类系统级反馈（它们自身 z-50 / z-60）覆盖。countdown 期间用户不会
 * 触发其他对话框（store 守卫已经禁用对应动作），所以层叠冲突基本不存在。
 */
export function CountdownOverlay(): React.JSX.Element | null {
  const { t } = useTranslation()
  const playback = useEditorStore((s) => s.playback)
  const remaining = useEditorStore((s) => s.countdownRemaining)
  const cancelCountdown = useEditorStore((s) => s.cancelCountdown)

  if (playback !== 'countdown') return null

  return (
    <div
      onClick={cancelCountdown}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/70 text-fg"
    >
      {/*
        大数字用 tabular-nums 防止从 3 → 2 → 1 时数字宽度跳动。
        字号用 inline style 是因为 8rem 大小 Tailwind 默认配色 / 字号体系外，
        这里是单一一处特殊用法，没必要扩 theme
      */}
      <div className="font-mono tabular-nums text-rec" style={{ fontSize: '8rem', lineHeight: 1 }}>
        {remaining}
      </div>
      <div className="text-xs text-fg-muted">{t('countdown.cancel_hint')}</div>
    </div>
  )
}
