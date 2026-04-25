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
      /**
       * 拆分前 source 的 gapAfter——必须保存以正确处理拆分边界：
       * apply 时把它转交给后半段（它才是新的「最后一段」、对接原下一段），
       * 前半段 gapAfter 被清零（中间是新的内部边界，不该有间隔）。
       * revert 时再把这份 gapAfter 还回前半段
       */
      sourceGapBefore: { ms: number; manual?: boolean } | undefined
      /** 新生成的后半段 Segment ID（apply 时用，revert 时删它） */
      newSegmentId: string
      /** 新 Segment 在 order 中的插入位置（一般是 source 的下一位） */
      newSegmentIndex: number
      /** 拆分前后的选中 Segment（拆完默认仍选 source） */
      prevSelectedSegmentId: string | undefined
      nextSelectedSegmentId: string | undefined
    }
  | {
      type: 'deleteSegmentsBatch'
      /** 按删除前 order 中的位置 sort 好（小→大）的所有被删条目 */
      removed: Array<{ index: number; segment: Segment }>
      prevSelectedSegmentId: string | undefined
      nextSelectedSegmentId: string | undefined
    }
  | {
      type: 'insertSegment'
      /** 插入位置（在 order 中的下标） */
      index: number
      segment: Segment
      prevSelectedSegmentId: string | undefined
      nextSelectedSegmentId: string | undefined
    }
  | {
      type: 'clearSegments'
      /** 清空前完整状态——和 importScript 同样思路：覆盖式操作只能全量回退 */
      beforeOrder: string[]
      beforeSegmentsById: Record<string, Segment>
      beforeSelectedSegmentId: string | undefined
    }
  | {
      type: 'setParagraphStart'
      segId: string
      before: boolean | undefined
      after: boolean
    }
  | {
      type: 'replaceAll'
      find: string
      replaceWith: string
      /** 实际改了 text 的所有 segment 的 before / after */
      edits: Array<{ segId: string; before: string; after: string }>
    }
  | {
      type: 'setSegmentGap'
      segId: string
      /** 改之前的 gapAfter，可能是 undefined */
      before: { ms: number; manual?: boolean } | undefined
      after: { ms: number; manual?: boolean } | undefined
    }
  | {
      type: 'applyDefaultGaps'
      /** 仅记录被覆盖的 segments：对每个原本非 manual 的段，记录 before / after */
      edits: Array<{
        segId: string
        before: { ms: number; manual?: boolean } | undefined
        after: { ms: number; manual?: boolean } | undefined
      }>
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
      /**
       * 合并前接收方的 gapAfter。
       * apply 时丢弃它（merged 体的 gapAfter 来自 mergedSegment——它本来就是
       * 「与下一段的间隔」），revert 时还回 target
       */
      targetGapBefore: { ms: number; manual?: boolean } | undefined
      /** 被合并掉、在合并后从 segmentsById 中删除的源 Segment（含 takes / gapAfter） */
      mergedSegment: Segment
      /** mergedSegment 在原 order 里的下标 */
      mergedIndex: number
      /** 合并前后的选中 Segment（合并后默认选 target） */
      prevSelectedSegmentId: string | undefined
      nextSelectedSegmentId: string | undefined
    }

/**
 * 入栈条目的存储格式。
 *
 * 不再保存 Command 联合类型，而是直接持有 apply / revert 闭包——调用方在
 * push 时把「这次怎么做、撤销时怎么做」用闭包捕获下来。好处：
 *   - 中央 dispatcher 消失，每条 mutation 的 apply/revert 紧贴它的 mutation site
 *   - 加新 mutation 不再需要往全局 Command union / applyCommand / revertCommand
 *     三处加分支，本地写完即可
 *
 * 兼容：旧的 push(coalesceKey, labelKey, command) 调用通过 wrapper 把 command
 * 包成闭包后存到这里，所以新旧 push 路径产生的 entry 同形态，undo / redo
 * 不需要分支。下一步逐个迁移 mutation，最后删除 Command + applyCommand/
 * revertCommand 的 dispatcher（见 #19 后续 commit）
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

  /**
   * 重载：
   *   - push(spec)：新 API，传 { coalesceKey, labelKey, apply, revert, mergeable? }
   *   - push(coalesceKey, labelKey, command)：旧 API，把 Command 包装成闭包后入栈
   *
   * 旧 API 只为兼容尚未迁移的 mutation，下一步会逐个 call site 切到新形式
   */
  push: ((spec: HistoryCommandSpec) => void) &
    ((coalesceKey: string, labelKey: string, command: Command) => void)

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
 * 合并规则（Strategy A）：top.coalesceKey === entry.coalesceKey && 时间窗内
 * && 两条都 mergeable → 用 entry.apply 替换 top.apply、保留 top.revert。
 * 这意味着 redo 直接到达最新状态，undo 一次回到「连续编辑前」的最早值——
 * 与原 mergeCoalescable 在 editText / setSegmentGap 上的语义等价。
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

  // 实现签名是宽松的 (a, b?, c?)，运行期按参数形态分派。新 API 只传一个对象，
  // 旧 API 传三个参数；TypeScript 重载（HistoryState.push）保证调用点类型安全。
  push: ((
    a: HistoryCommandSpec | string,
    b?: string,
    c?: Command
  ) => {
    const now = Date.now()
    if (typeof a !== 'string') {
      // 新 API
      const spec = a
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
      return
    }
    // 旧 API：把 Command 包成闭包，并通过 mergeCoalescable 决定可合并性
    const command = c as Command
    const labelKey = b as string
    const coalesceKey = a
    const mergeable = isLegacyMergeable(command)
    set((state) =>
      pushEntry(state, {
        coalesceKey,
        labelKey,
        apply: () => applyCommand(command),
        revert: () => revertCommand(command),
        mergeable,
        ts: now
      })
    )
  }) as HistoryState['push'],

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

/**
 * 旧 Command 是否参与合并：保留与原 mergeCoalescable 完全一致的语义，
 * 仅 editText / setSegmentGap 两类支持。其他 type 的 Command 入栈时
 * mergeable = false，永远独立成条目。
 */
function isLegacyMergeable(cmd: Command): boolean {
  return cmd.type === 'editText' || cmd.type === 'setSegmentGap'
}

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
        // 后半段继承原 gapAfter（它现在是对外的「最后一段」），前半段清零
        const newSegment: Segment = {
          id: cmd.newSegmentId,
          text: afterText,
          takes: []
        }
        if (cmd.sourceGapBefore) newSegment.gapAfter = { ...cmd.sourceGapBefore }
        const frontSegment = { ...source, text: beforeText }
        delete frontSegment.gapAfter
        const nextOrder = s.order.slice()
        nextOrder.splice(cmd.newSegmentIndex, 0, cmd.newSegmentId)
        return {
          order: nextOrder,
          segmentsById: {
            ...s.segmentsById,
            [cmd.sourceSegmentId]: frontSegment,
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
        // merged 体的 gapAfter 接管 mergedSegment 的（= 合并体到下一段的间隔），
        // target 原来的 gapAfter（= 合并前 target 到 mergedSegment 的内部边界）丢弃
        const mergedTarget = {
          ...target,
          text: cmd.targetTextAfter,
          takes: [...cmd.targetTakesBefore, ...cmd.mergedSegment.takes]
        }
        if (cmd.mergedSegment.gapAfter) {
          mergedTarget.gapAfter = { ...cmd.mergedSegment.gapAfter }
        } else {
          delete mergedTarget.gapAfter
        }
        nextById[cmd.targetSegmentId] = mergedTarget
        return {
          order: nextOrder,
          segmentsById: nextById,
          selectedSegmentId: cmd.nextSelectedSegmentId
        }
      })
      return
    case 'deleteSegmentsBatch':
      editor.applyHistoryPatch((s) => {
        const removedIds = new Set(cmd.removed.map((r) => r.segment.id))
        const nextById = { ...s.segmentsById }
        for (const id of removedIds) delete nextById[id]
        return {
          order: s.order.filter((id) => !removedIds.has(id)),
          segmentsById: nextById,
          selectedSegmentId: cmd.nextSelectedSegmentId
        }
      })
      return
    case 'insertSegment':
      editor.applyHistoryPatch((s) => {
        const nextOrder = s.order.slice()
        nextOrder.splice(Math.min(cmd.index, nextOrder.length), 0, cmd.segment.id)
        return {
          order: nextOrder,
          segmentsById: { ...s.segmentsById, [cmd.segment.id]: cmd.segment },
          selectedSegmentId: cmd.nextSelectedSegmentId
        }
      })
      return
    case 'clearSegments':
      editor.applyHistoryPatch(() => ({
        order: [],
        segmentsById: {},
        selectedSegmentId: undefined
      }))
      return
    case 'setParagraphStart':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        // 设为 false 时把字段置 undefined，存储更紧凑
        const next = { ...seg }
        if (cmd.after) next.paragraphStart = true
        else delete next.paragraphStart
        return {
          segmentsById: { ...s.segmentsById, [cmd.segId]: next }
        }
      })
      return
    case 'replaceAll':
      editor.applyHistoryPatch((s) => {
        const nextById = { ...s.segmentsById }
        for (const e of cmd.edits) {
          const seg = nextById[e.segId]
          if (!seg) continue
          nextById[e.segId] = { ...seg, text: e.after }
        }
        return { segmentsById: nextById }
      })
      return
    case 'setSegmentGap':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        const next = { ...seg }
        if (cmd.after) next.gapAfter = { ...cmd.after }
        else delete next.gapAfter
        return { segmentsById: { ...s.segmentsById, [cmd.segId]: next } }
      })
      return
    case 'applyDefaultGaps':
      editor.applyHistoryPatch((s) => {
        const nextById = { ...s.segmentsById }
        for (const e of cmd.edits) {
          const seg = nextById[e.segId]
          if (!seg) continue
          const nextSeg = { ...seg }
          if (e.after) nextSeg.gapAfter = { ...e.after }
          else delete nextSeg.gapAfter
          nextById[e.segId] = nextSeg
        }
        return { segmentsById: nextById }
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
        // revert 拆分：删掉新 Segment，把 source.text 还原成原始完整文本，
        // 把 sourceGapBefore 还回前段（apply 时它被转交给了后段）
        const nextOrder = s.order.filter((id) => id !== cmd.newSegmentId)
        const nextById = { ...s.segmentsById }
        delete nextById[cmd.newSegmentId]
        const restored = { ...source, text: cmd.sourceTextBefore }
        if (cmd.sourceGapBefore) restored.gapAfter = { ...cmd.sourceGapBefore }
        else delete restored.gapAfter
        nextById[cmd.sourceSegmentId] = restored
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
        // revert 合并：把 mergedSegment 重新插回 order，target 的 text / takes / gapAfter 还原
        const nextOrder = s.order.slice()
        nextOrder.splice(cmd.mergedIndex, 0, cmd.mergedSegment.id)
        const restoredTarget = {
          ...target,
          text: cmd.targetTextBefore,
          takes: cmd.targetTakesBefore
        }
        if (cmd.targetGapBefore) restoredTarget.gapAfter = { ...cmd.targetGapBefore }
        else delete restoredTarget.gapAfter
        return {
          order: nextOrder,
          segmentsById: {
            ...s.segmentsById,
            [cmd.targetSegmentId]: restoredTarget,
            [cmd.mergedSegment.id]: cmd.mergedSegment
          },
          selectedSegmentId: cmd.prevSelectedSegmentId
        }
      })
      return
    case 'deleteSegmentsBatch':
      editor.applyHistoryPatch((s) => {
        // revert：按 index 升序逐个 splice 回 order，segmentsById 整体并入。
        // index 是删除前的下标，按升序处理保证插入位置正确（每次插入会让后续
        // entry 的 index 自然偏移，但 cmd.removed 的 index 是相对 beforeOrder
        // 的——所以我们需要从 beforeOrder 重建顺序）
        const orderSet = new Set(s.order)
        const nextById = { ...s.segmentsById }
        for (const r of cmd.removed) {
          nextById[r.segment.id] = r.segment
          orderSet.add(r.segment.id)
        }
        // 重建 order：按「removed 的 index 升序」决定插入位置。从 s.order
        // 出发，逐条 splice 进对应位置
        const nextOrder = s.order.slice()
        const sorted = cmd.removed.slice().sort((a, b) => a.index - b.index)
        for (const r of sorted) {
          // 计算实际插入位置：r.index 是删除前的下标，但 nextOrder 此时
          // 已经包含一些之前 splice 进去的条目，所以直接用 r.index 即可
          // （前面 splice 的 index 都 ≤ 当前 r.index，且每 splice 一次
          // 后续 r.index 都自然加 1）
          nextOrder.splice(Math.min(r.index, nextOrder.length), 0, r.segment.id)
        }
        return {
          order: nextOrder,
          segmentsById: nextById,
          selectedSegmentId: cmd.prevSelectedSegmentId
        }
      })
      return
    case 'insertSegment':
      editor.applyHistoryPatch((s) => {
        const nextOrder = s.order.filter((id) => id !== cmd.segment.id)
        const nextById = { ...s.segmentsById }
        delete nextById[cmd.segment.id]
        return {
          order: nextOrder,
          segmentsById: nextById,
          selectedSegmentId: cmd.prevSelectedSegmentId
        }
      })
      return
    case 'clearSegments':
      editor.applyHistoryPatch(() => ({
        order: cmd.beforeOrder.slice(),
        segmentsById: { ...cmd.beforeSegmentsById },
        selectedSegmentId: cmd.beforeSelectedSegmentId
      }))
      return
    case 'setParagraphStart':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        const next = { ...seg }
        if (cmd.before) next.paragraphStart = true
        else delete next.paragraphStart
        return {
          segmentsById: { ...s.segmentsById, [cmd.segId]: next }
        }
      })
      return
    case 'replaceAll':
      editor.applyHistoryPatch((s) => {
        const nextById = { ...s.segmentsById }
        for (const e of cmd.edits) {
          const seg = nextById[e.segId]
          if (!seg) continue
          nextById[e.segId] = { ...seg, text: e.before }
        }
        return { segmentsById: nextById }
      })
      return
    case 'setSegmentGap':
      editor.applyHistoryPatch((s) => {
        const seg = s.segmentsById[cmd.segId]
        if (!seg) return null
        const next = { ...seg }
        if (cmd.before) next.gapAfter = { ...cmd.before }
        else delete next.gapAfter
        return { segmentsById: { ...s.segmentsById, [cmd.segId]: next } }
      })
      return
    case 'applyDefaultGaps':
      editor.applyHistoryPatch((s) => {
        const nextById = { ...s.segmentsById }
        for (const e of cmd.edits) {
          const seg = nextById[e.segId]
          if (!seg) continue
          const nextSeg = { ...seg }
          if (e.before) nextSeg.gapAfter = { ...e.before }
          else delete nextSeg.gapAfter
          nextById[e.segId] = nextSeg
        }
        return { segmentsById: nextById }
      })
      return
  }
}
