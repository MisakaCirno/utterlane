import { create } from 'zustand'
import { useEditorStore } from './editorStore'

/**
 * Undo / Redo 历史栈。
 *
 * === 为什么是命令模式而不是快照 ===
 *
 * 早期方案想过直接存「修改前的 { order, segmentsById } 引用」作为快照，
 * 利用 immutable update 天然形成结构共享。但这个方案在录音场景下会丢 Take：
 *
 *   1. 编辑 A 文本 → 推入快照 S0（此时 A.takes = [T0]）
 *   2. 在 A 录制 T1 → 当前 segmentsById 有 [T0, T1]，history 不更新（录音不进栈）
 *   3. 用户 undo → 用 S0 整体覆盖 → A.takes 回到 [T0]，T1 从 segments.json 消失
 *   4. 任意后续编辑会清 future → T1.wav 永久变成孤儿文件
 *
 * 命令模式让每条 entry 描述「这次改了什么 + 怎么反着改回去」，undo 只
 * 影响命令本身触达的字段，录音对 takes 数组的改动不会被「编辑文本」
 * 的 undo 覆盖回去。
 *
 * === 命令的载体：apply / revert 闭包 ===
 *
 * 每条 entry 直接持有 apply / revert 两个函数，由 mutation site 在 push 时
 * 用闭包捕获所需数据后构造。撤销 / 重做时 store 简单地调闭包即可，没有
 * 中央 dispatcher。加新动作时不需要往全局 type union + dispatcher 三处
 * 同步加分支，本地写完即可。
 *
 * === 合并规则 ===
 *
 * 标 mergeable: true 的 entry，在同 coalesceKey + 时间窗内（COALESCE_WINDOW_MS）
 * 与栈顶合并：保留 top 的 revert（最早的原始状态）+ 采用 next 的 apply
 * （最新状态）+ 时间戳更新到 next.ts。语义上 = 「连续的小步修改作为一格
 * undo」。当前两类需要合并：editText（连续打字）和 setSegmentGap（连续
 * 拖拽时间轴间隔）。
 *
 * === 播放 / 录音期间禁用 ===
 *
 * undo / redo 在 playback !== 'idle' 时是 no-op，避免录音中途撤销导致
 * stopRecordingAndSave 找不到 Segment、播放中途改顺序让用户困惑。实际的
 * mutation 在播放期间是否允许，由上层 UI 决定；本 store 只保证 undo /
 * redo 自身在非空闲态下不动。
 *
 * === 录音不进栈 ===
 *
 * 录音 / 重录不 push 命令，因为它们有文件系统副作用（写 WAV）undo 无法
 * 真正回滚。重录更特殊——原文件被物理覆盖，revert 回去是谎言。用户要撤销
 * 一次录音的正确路径是「删除 Take」，这个动作本身是进栈的，且 deleteTake
 * 的 revert 只改 segments.json，不碰 WAV 文件，于是 undo 后 Take 引用
 * 恢复，磁盘上的 WAV 原本就还在，能立刻播放。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 同一 coalesceKey 在此时间窗内连续 push 时合并为单条 entry */
const COALESCE_WINDOW_MS = 1500

/** 历史栈深度上限，超过后从栈底丢弃 */
const MAX_STACK = 100

// ---------------------------------------------------------------------------
// 命令 / 入栈条目
// ---------------------------------------------------------------------------

/**
 * 入栈条目：直接持有 apply / revert 闭包，没有 dispatcher。
 *
 * mutation site 在 push 时用闭包捕获所需数据，apply 是给 redo 用的「再
 * 做一遍」、revert 是给 undo 用的「反过来做一遍」。两个闭包内部一般通过
 * editorStore.applyHistoryPatch(fn) 改 store——applyHistoryPatch 统一处
 * 理 markDirty + scheduleSegmentsSave + pushWorkspace 副作用。
 */
export type HistoryEntry = {
  /** 合并判定用：同 key + 同时间窗 = 合并进栈顶 */
  coalesceKey: string
  /** i18n key，用于菜单显示「撤销：编辑文案」这类动态标签 */
  labelKey: string
  ts: number
  /** 重做时执行 */
  apply: () => void
  /** 撤销时执行 */
  revert: () => void
  /**
   * 是否参与合并。仅 editText / setSegmentGap 这类「同一目标的连续小步
   * 修改」需要合并；删除 / 拆分等结构性操作每次独立。
   */
  mergeable: boolean
}

/**
 * 新 push API 接收的规约。
 *
 * apply / revert 必须是纯粹改 store 状态的函数：调用方在 push 之前已经
 * 完成了「现在的 mutation」，apply 是给 redo 用的「再做一遍」、revert
 * 是给 undo 用的「反过来做一遍」。
 */
export type HistoryCommandSpec = {
  coalesceKey: string
  labelKey: string
  apply: () => void
  revert: () => void
  /** 默认 false。同 coalesceKey + 同窗内 → 与上一条合并：保留旧的 revert，采用新的 apply */
  mergeable?: boolean
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type HistoryState = {
  past: HistoryEntry[]
  future: HistoryEntry[]

  /** 推入一条命令；调用方应该在执行 mutation 之前或之后都行，本函数不执行命令 */
  push: (spec: HistoryCommandSpec) => void

  /** 撤销栈顶；playback !== 'idle' 或 past 为空时 no-op */
  undo: () => void
  /** 重做；playback !== 'idle' 或 future 为空时 no-op */
  redo: () => void

  /** 清空两端栈（工程切换时调用） */
  clear: () => void
}

/**
 * 内部统一入栈：拿到完整 entry shape 后做合并 / append。
 *
 * 合并规则：top.coalesceKey === entry.coalesceKey && 时间窗内 && 两条都
 * mergeable → 用 entry.apply 替换 top.apply、保留 top.revert，时间戳更新
 * 到 entry.ts。redo 直接到达最新状态，undo 一次回到「连续编辑前」的最早
 * 状态。
 */
function pushEntry(
  state: { past: HistoryEntry[] },
  entry: HistoryEntry
): { past: HistoryEntry[]; future: HistoryEntry[] } {
  const { past } = state
  const top = past[past.length - 1]
  if (
    top &&
    top.mergeable &&
    entry.mergeable &&
    top.coalesceKey === entry.coalesceKey &&
    entry.ts - top.ts < COALESCE_WINDOW_MS
  ) {
    const merged: HistoryEntry = {
      ...top,
      ts: entry.ts,
      apply: entry.apply,
      labelKey: entry.labelKey
    }
    const nextPast = past.slice()
    nextPast[nextPast.length - 1] = merged
    return { past: nextPast, future: [] }
  }

  const nextPast = [...past, entry]
  // 超上限从底部丢弃，避免长期使用下无限增长
  if (nextPast.length > MAX_STACK) nextPast.splice(0, nextPast.length - MAX_STACK)
  return { past: nextPast, future: [] }
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  push: (spec) => {
    const now = Date.now()
    set((state) =>
      pushEntry(state, {
        coalesceKey: spec.coalesceKey,
        labelKey: spec.labelKey,
        apply: spec.apply,
        revert: spec.revert,
        mergeable: !!spec.mergeable,
        ts: now
      })
    )
  },

  undo: () => {
    const editor = useEditorStore.getState()
    if (editor.playback !== 'idle') return
    const { past, future } = get()
    const entry = past[past.length - 1]
    if (!entry) return

    entry.revert()
    set({ past: past.slice(0, -1), future: [...future, entry] })
  },

  redo: () => {
    const editor = useEditorStore.getState()
    if (editor.playback !== 'idle') return
    const { past, future } = get()
    const entry = future[future.length - 1]
    if (!entry) return

    entry.apply()
    set({ future: future.slice(0, -1), past: [...past, entry] })
  },

  clear: () => set({ past: [], future: [] })
}))
