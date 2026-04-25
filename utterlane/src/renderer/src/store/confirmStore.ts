import { create } from 'zustand'

/**
 * 全局确认对话框的 Promise 式接口。
 *
 * 典型用法：
 *   const ok = await confirm({ title: '删除这条 Segment?', tone: 'danger' })
 *   if (ok) ...
 *
 * 为什么不给每个需要 confirm 的调用点传 React 状态：
 *   大多数使用点是命令式代码（store action / 菜单 handler / 快捷键），
 *   它们没有 React 上下文也不希望引入。
 *   全局队列 + 一个 Promise resolver 是最轻量的方案。
 *
 * 限制：同时只能有一个 pending confirm；前一个还没关掉就 show 第二个的话，
 * 第二次 show 会先把第一个当作「取消」resolve 掉再替换。这在实际工作流里
 * 不会发生（用户看到对话框后手动响应才会走到下一条命令）。
 */

export type ConfirmTone = 'default' | 'danger'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  /**
   * Alert 模式：不显示取消按钮，只有确认按钮（标签默认为「OK」）。
   * 用于「告知 + 必须确认」场景，比如录音失败这种用户必须看到的错误
   */
  hideCancel?: boolean
}

type PendingConfirm = ConfirmOptions & {
  resolve: (ok: boolean) => void
}

type ConfirmState = {
  pending: PendingConfirm | null
  resolve: (ok: boolean) => void
  show: (opts: ConfirmOptions) => Promise<boolean>
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  pending: null,

  resolve: (ok) => {
    const p = get().pending
    if (!p) return
    set({ pending: null })
    p.resolve(ok)
  },

  show: (opts) => {
    // 清掉任何 pending 的，按取消处理
    const prev = get().pending
    if (prev) {
      set({ pending: null })
      prev.resolve(false)
    }
    return new Promise<boolean>((resolve) => {
      set({ pending: { ...opts, resolve } })
    })
  }
}))

/** 非组件调用方的便捷入口 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().show(opts)
}

/**
 * 单按钮模态提示（alert）。封装在 confirm 之上：复用同一个 dialog host，
 * 但隐藏取消按钮。用户必须点 OK 才会消失，不会自动关。
 *
 * 用于「严重错误必须告知 + 用户必须确认看到」的场景：录音落盘失败 / 工程
 * 文件写入失败 / 等。toast 一闪而过，alert 强制 acknowledge
 */
export function alert(opts: {
  title: string
  description?: string
  okLabel?: string
  tone?: ConfirmTone
}): Promise<void> {
  return useConfirmStore
    .getState()
    .show({
      title: opts.title,
      description: opts.description,
      confirmLabel: opts.okLabel ?? 'OK',
      tone: opts.tone,
      hideCancel: true
    })
    .then(() => undefined)
}
