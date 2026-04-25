import { create } from 'zustand'
import type { Segment, Take } from '@renderer/types/project'
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
 * 命令模式把每条 entry 记成「这次改了什么 + 怎么反着改回去」，undo 只影响
 * 命令本身触达的字段，录音对 takes 数组的改动不会被「编辑文本」的 undo
 * 覆盖回去。代价是每种 action 都要实现 apply / revert 两支，但 action 种类
 * 有限（6 种），代码可控。
 *
 * === 合并规则 ===
 *
 * 文本编辑按 coalesceKey + 时间窗合并：同一 Segment 连续输入在
 * COALESCE_WINDOW_MS 内只计一条 entry，替换末尾 after 但保留最早的 before，
 * 这样 undo 一次回到编辑开始前的状态。其他动作每次独立一条，不合并。
 *
 * === 播放 / 录音期间禁用 ===
 *
 * canUndo / canRedo 在 playback !== 'idle' 时返回 false，避免录音中途撤销
 * 导致 stopRecordingAndSave 找不到 Segment，或播放中途改顺序让用户困惑。
 * 实际的 mutation 在播放期间是否允许，由上层 UI 决定；本 store 只保证
 * undo / redo 自身在非空闲态下是 no-op。
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
// 命令类型
// ---------------------------------------------------------------------------

/**
 * 所有可撤销动作的联合类型。
 * 每条命令只存「需要 revert 回去的字段」和「apply 再次执行所需字段」，
 * 不存完整 segmentsById 快照——这是和录音共存的关键。
 */
export type Command =
  | {
      type: 'editText'
      segId: string
      before: string
      after: string
    }
  | {
      type: 'reorder'
      before: string[]
      after: string[]
    }
  | {
      type: 'deleteSegment'
      /** 被删除 Segment 的 id */
      id: string
      /** 在 order 中的索引，revert 时用来插回原位 */
      index: number
      /** 完整的 Segment 对象（含 takes），revert 时整体塞回 segmentsById */
      segment: Segment
      /** 删除前的选中 Segment（undo 后要恢复成它） */
      prevSelectedSegmentId: string | undefined
      /** 删除后的选中 Segment（redo 要恢复成它） */
      nextSelectedSegmentId: string | undefined
    }
  | {
      type: 'deleteTake'
      segId: string
      /** 在 segment.takes 中的索引，revert 时插回原位 */
      takeIndex: number
      take: Take
      prevSelectedTakeId: string | undefined
      nextSelectedTakeId: string | undefined
    }
  | {
      type: 'setSelectedTake'
      segId: string
      before: string | undefined
      after: string
    }
  | {
      type: 'importScript'
      /** 导入前的完整 Segments 状态；importScript 本身就是覆盖式，revert 只能全量回退 */
      beforeOrder: string[]
      beforeSegmentsById: Record<string, Segment>
      beforeSelectedSegmentId: string | undefined
      afterOrder: string[]
      afterSegmentsById: Record<string, Segment>
      afterSelectedSegmentId: string | undefined
    }
  | {
      type: 'splitSegment'
      /** 被拆分的源 Segment ID（apply 后保留前半段文本） */
      sourceSegmentId: string
      /** 拆分前的完整文本 */
      sourceTextBefore: string
      /** 拆分位置（字符索引） */
      splitAt: number
      /** 新生成的后半段 Segment ID（apply 时用，revert 时删它） */
      newSegmentId: string
      /** 新 Segment 在 order 中的插入位置（一般是 source 的下一位） */
      newSegmentIndex: number
      /** 拆分前后的选中 Segment（拆完默认仍选 source） */
      prevSelectedSegmentId: string | undefined
      nextSelectedSegmentId: string | undefined
    }
  | {
      type: 'mergeSegment'
      /** 接收方 Segment ID（合并后留下的那个，一般是前一段） */
      targetSegmentId: string
      /** 合并前接收方的文本 */
      targetTextBefore: string
      /** 合并后接收方的完整文本（targetTextBefore + 分隔符 + mergedSegment.text） */
      targetTextAfter: string
      /** 合并前接收方的 takes 列表 */
      targetTakesBefore: Take[]
      /** 被合并掉、在合并后从 segmentsById 中删除的源 Segment（含 takes） */
      mergedSegment: Segment
      /** mergedSegment 在原 order 里的下标 */
      mergedIndex: number
      /** 合并前后的选中 Segment（合并后默认选 target） */
      prevSelectedSegmentId: string | undefined
      nextSelectedSegmentId: string | undefined
    }

export type HistoryEntry = {
  command: Command
  /** 合并判定用：同 key + 同时间窗 = 合并进栈顶 */
  coalesceKey: string
  /** i18n key，用于菜单显示「撤销：编辑文案」这类动态标签 */
  labelKey: string
  ts: number
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type HistoryState = {
  past: HistoryEntry[]
  future: HistoryEntry[]

  /** 推入一条命令；调用方应该在执行 mutation 之前或之后都行，本函数不执行命令 */
  push: (coalesceKey: string, labelKey: string, command: Command) => void

  /** 撤销栈顶；playback !== 'idle' 或 past 为空时 no-op */
  undo: () => void
  /** 重做；playback !== 'idle' 或 future 为空时 no-op */
  redo: () => void

  /** 清空两端栈（工程切换时调用） */
  clear: () => void
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  push: (coalesceKey, labelKey, command) => {
    const now = Date.now()
    const { past } = get()
    const top = past[past.length - 1]

    // 同 coalesceKey 且在时间窗内 → 合并：仅连续文本编辑会走到这里。
    // 合并策略：保留 top.command.before（最早的原始值），把 top.command.after
    // 替换成当前命令的 after；ts 更新为 now，让时间窗继续延展。
    if (
      top &&
      top.coalesceKey === coalesceKey &&
      now - top.ts < COALESCE_WINDOW_MS &&
      top.command.type === 'editText' &&
      command.type === 'editText' &&
      top.command.segId === command.segId
    ) {
      const mergedTop: HistoryEntry = {
        ...top,
        ts: now,
        command: { ...top.command, after: command.after }
      }
      const nextPast = past.slice()
      nextPast[nextPast.length - 1] = mergedTop
      // 新一轮编辑也要清 future
      set({ past: nextPast, future: [] })
      return
    }

    const entry: HistoryEntry = { command, coalesceKey, labelKey, ts: now }
    const nextPast = [...past, entry]
    // 超上限从底部丢弃，避免长期使用下无限增长
    if (nextPast.length > MAX_STACK) nextPast.splice(0, nextPast.length - MAX_STACK)
    set({ past: nextPast, future: [] })
  },

  undo: () => {
    const editor = useEditorStore.getState()
    if (editor.playback !== 'idle') return
    const { past, future } = get()
    const entry = past[past.length - 1]
    if (!entry) return

    revertCommand(entry.command)
    set({ past: past.slice(0, -1), future: [...future, entry] })
  },

  redo: () => {
    const editor = useEditorStore.getState()
    if (editor.playback !== 'idle') return
    const { past, future } = get()
    const entry = future[future.length - 1]
    if (!entry) return

    applyCommand(entry.command)
    set({ future: future.slice(0, -1), past: [...past, entry] })
  },

  clear: () => set({ past: [], future: [] })
}))

// ---------------------------------------------------------------------------
// apply / revert dispatcher
//
// 直接操作 editorStore 的 state，走和普通 mutation 一样的 setState 通路。
// 每个分支都要调用 editorStore.applyHistoryPatch，由它负责 schedule 保存、
// 标记 dirty、push workspace，保持和普通 mutation 的副作用对齐。
// ---------------------------------------------------------------------------

function applyCommand(cmd: Command): void {
  const editor = useEditorStore.getState()
  switch (cmd.type) {
    case 'editText':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        return {
          segmentsById: { ...s.segmentsById, [cmd.segId]: { ...seg, text: cmd.after } }
        }
      })
      return
    case 'reorder':
      editor.applyHistoryPatch(() => ({ order: cmd.after.slice() }))
      return
    case 'deleteSegment':
      editor.applyHistoryPatch((s) => {
        const nextOrder = s.order.filter((id) => id !== cmd.id)
        const nextById = { ...s.segmentsById }
        delete nextById[cmd.id]
        return {
          order: nextOrder,
          segmentsById: nextById,
          selectedSegmentId: cmd.nextSelectedSegmentId
        }
      })
      return
    case 'deleteTake':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        const nextTakes = seg.takes.filter((t) => t.id !== cmd.take.id)
        return {
          segmentsById: {
            ...s.segmentsById,
            [cmd.segId]: {
              ...seg,
              takes: nextTakes,
              selectedTakeId: cmd.nextSelectedTakeId
            }
          }
        }
      })
      return
    case 'setSelectedTake':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        return {
          segmentsById: {
            ...s.segmentsById,
            [cmd.segId]: { ...seg, selectedTakeId: cmd.after }
          }
        }
      })
      return
    case 'importScript':
      editor.applyHistoryPatch(() => ({
        order: cmd.afterOrder.slice(),
        segmentsById: { ...cmd.afterSegmentsById },
        selectedSegmentId: cmd.afterSelectedSegmentId
      }))
      return
    case 'splitSegment':
      editor.applyHistoryPatch((s) => {
        const source = s.segmentsById[cmd.sourceSegmentId]
        if (!source) return null
        const beforeText = cmd.sourceTextBefore.slice(0, cmd.splitAt).trimEnd()
        const afterText = cmd.sourceTextBefore.slice(cmd.splitAt).trimStart()
        const newSegment: Segment = {
          id: cmd.newSegmentId,
          text: afterText,
          takes: []
        }
        const nextOrder = s.order.slice()
        nextOrder.splice(cmd.newSegmentIndex, 0, cmd.newSegmentId)
        return {
          order: nextOrder,
          segmentsById: {
            ...s.segmentsById,
            [cmd.sourceSegmentId]: { ...source, text: beforeText },
            [cmd.newSegmentId]: newSegment
          },
          selectedSegmentId: cmd.nextSelectedSegmentId
        }
      })
      return
    case 'mergeSegment':
      editor.applyHistoryPatch((s) => {
        const target = s.segmentsById[cmd.targetSegmentId]
        if (!target) return null
        const nextOrder = s.order.filter((id) => id !== cmd.mergedSegment.id)
        const nextById = { ...s.segmentsById }
        delete nextById[cmd.mergedSegment.id]
        nextById[cmd.targetSegmentId] = {
          ...target,
          text: cmd.targetTextAfter,
          takes: [...cmd.targetTakesBefore, ...cmd.mergedSegment.takes]
        }
        return {
          order: nextOrder,
          segmentsById: nextById,
          selectedSegmentId: cmd.nextSelectedSegmentId
        }
      })
      return
  }
}

function revertCommand(cmd: Command): void {
  const editor = useEditorStore.getState()
  switch (cmd.type) {
    case 'editText':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        return {
          segmentsById: { ...s.segmentsById, [cmd.segId]: { ...seg, text: cmd.before } }
        }
      })
      return
    case 'reorder':
      editor.applyHistoryPatch(() => ({ order: cmd.before.slice() }))
      return
    case 'deleteSegment':
      editor.applyHistoryPatch((s) => {
        // 即便在删除之后 takes 被别的操作动过（比如孤儿清理、未来可能的修复），
        // 这里存的 cmd.segment 是删除发生那一刻的快照，revert 回去是正确的：
        // 用户对「撤销删除 Segment」的预期就是「把当时那个 Segment 整个还回来」
        const nextOrder = s.order.slice()
        const insertAt = Math.min(cmd.index, nextOrder.length)
        nextOrder.splice(insertAt, 0, cmd.id)
        return {
          order: nextOrder,
          segmentsById: { ...s.segmentsById, [cmd.id]: cmd.segment },
          selectedSegmentId: cmd.prevSelectedSegmentId
        }
      })
      return
    case 'deleteTake':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        const nextTakes = seg.takes.slice()
        const insertAt = Math.min(cmd.takeIndex, nextTakes.length)
        nextTakes.splice(insertAt, 0, cmd.take)
        return {
          segmentsById: {
            ...s.segmentsById,
            [cmd.segId]: {
              ...seg,
              takes: nextTakes,
              selectedTakeId: cmd.prevSelectedTakeId
            }
          }
        }
      })
      return
    case 'setSelectedTake':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        return {
          segmentsById: {
            ...s.segmentsById,
            [cmd.segId]: { ...seg, selectedTakeId: cmd.before }
          }
        }
      })
      return
    case 'importScript':
      editor.applyHistoryPatch(() => ({
        order: cmd.beforeOrder.slice(),
        segmentsById: { ...cmd.beforeSegmentsById },
        selectedSegmentId: cmd.beforeSelectedSegmentId
      }))
      return
    case 'splitSegment':
      editor.applyHistoryPatch((s) => {
        const source = s.segmentsById[cmd.sourceSegmentId]
        if (!source) return null
        // revert 拆分：删掉新 Segment，把 source.text 还原成原始完整文本
        const nextOrder = s.order.filter((id) => id !== cmd.newSegmentId)
        const nextById = { ...s.segmentsById }
        delete nextById[cmd.newSegmentId]
        nextById[cmd.sourceSegmentId] = { ...source, text: cmd.sourceTextBefore }
        return {
          order: nextOrder,
          segmentsById: nextById,
          selectedSegmentId: cmd.prevSelectedSegmentId
        }
      })
      return
    case 'mergeSegment':
      editor.applyHistoryPatch((s) => {
        const target = s.segmentsById[cmd.targetSegmentId]
        if (!target) return null
        // revert 合并：把 mergedSegment 重新插回 order，target 的 text / takes 还原
        const nextOrder = s.order.slice()
        nextOrder.splice(cmd.mergedIndex, 0, cmd.mergedSegment.id)
        return {
          order: nextOrder,
          segmentsById: {
            ...s.segmentsById,
            [cmd.targetSegmentId]: {
              ...target,
              text: cmd.targetTextBefore,
              takes: cmd.targetTakesBefore
            },
            [cmd.mergedSegment.id]: cmd.mergedSegment
          },
          selectedSegmentId: cmd.prevSelectedSegmentId
        }
      })
      return
  }
}
