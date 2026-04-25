import type { Segment } from '@renderer/types/project'
import { useHistoryStore } from '@renderer/store/historyStore'
import { useEditorStore } from '@renderer/store/editorStore'
import type { EditorActions, EditorState, SliceCreator } from './types'
import { markDirty, pushWorkspace, scheduleSegmentsSave } from './save'

/**
 * Segment / Take / Gap / Paragraph 的全部 mutation。
 *
 * 所有动作满足同一组副作用约定：
 *   - 通过 historyStore.push(...) 进 undo 栈（少数纯调试动作除外）
 *   - 写入 markDirty() 标记 + 调 scheduleSegmentsSave 触发 200ms debounce 落盘
 *   - 改 selectedSegmentId 时附带 pushWorkspace 让 workspace.json 同步
 *
 * === 新 push API ===
 *
 * 每条 mutation push 时直接传 { coalesceKey, labelKey, apply, revert }
 * 闭包，apply / revert 通过 applyHistoryPatch 把 patch 函数喂回 store——
 * patch 函数读「执行那一刻的 store 状态」决定怎么改，而不是依赖 push 时的
 * 闭包变量。这点很关键：deleteSegment 之类的命令在 redo 时如果直接复用
 * push 时的闭包数据，可能引用已被中间命令删掉的 Segment。让 patch 在
 * 当前 state 上算 delta 是更稳健的做法。
 *
 * 对编辑路径不变量的「初始 mutation」仍走 set() 直接修改，与 apply 在
 * 语义上重合但避免再走一次 applyHistoryPatch 的额外副作用调度——push 之后
 * 的 set 只是把当前已构造好的 next 状态落进去
 */

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/**
 * Segment.text 的数据不变量：单行、不含制表符。
 *
 * 把 \r \n \t 等「结构性」空白字符塌缩成一个普通空格，让一段文字永远是
 * 单行（导出 SRT 时一行字幕对应一段文字、时间轴 / 波形 / 字幕长度都不会
 * 因为多行而错乱）。普通的多空格不动——用户可能有意为之（停顿表达 / 输入
 * 错误恢复都常见）。
 *
 * trim 不在这里做：编辑过程中用户可能正在打头空格 / 尾空格，store 层 trim
 * 会让光标跳。提交（blur / Enter）时再由 UI 显式 trim
 */
export function sanitizeSegmentText(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ')
}

/** 比较两个 gap，undefined 与 { ms: 0, ... } 视作等价（两者都意味着「无间隔」） */
function gapEquals(
  a: { ms: number; manual?: boolean } | undefined,
  b: { ms: number; manual?: boolean } | undefined
): boolean {
  const aMs = a?.ms ?? 0
  const bMs = b?.ms ?? 0
  if (aMs !== bMs) return false
  // ms 都 0 时 manual 标志不重要（字段会被删）
  if (aMs === 0) return true
  return !!a?.manual === !!b?.manual
}

/**
 * 文案导入：按行切分成 Segment。
 *
 * 规则：
 *   - 去除行首尾空白
 *   - 单个空行视为段落边界：下一个非空行的 Segment 标记 paragraphStart = true
 *   - 连续多个空行折叠成一次段落边界（不会产生空段）
 *   - 第一段第一句默认 paragraphStart = true
 *
 * Segment id 用 crypto.randomUUID。
 */
function splitScriptIntoSegments(rawText: string): Segment[] {
  const lines = rawText.split(/\r?\n/)
  const segments: Segment[] = []
  // 第一段段首：首次进循环时 nextIsParagraphStart 为 true，遇到空行后再次置 true
  let nextIsParagraphStart = true
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) {
      nextIsParagraphStart = true
      continue
    }
    const seg: Segment = {
      id: crypto.randomUUID(),
      text: line,
      takes: []
    }
    // paragraphStart 仅在 true 时落字段，false 用 undefined 表达更省字节
    if (nextIsParagraphStart) seg.paragraphStart = true
    segments.push(seg)
    nextIsParagraphStart = false
  }
  return segments
}

/**
 * apply / revert 的运行通道：把一个 patch 函数喂给 editorStore.applyHistoryPatch，
 * 由它统一处理 markDirty + scheduleSegmentsSave + pushWorkspace 三件套。
 *
 * 用 lazy useEditorStore.getState() 而非传入 (set, get)：apply / revert 在
 * push 之后才执行，那时 store 已经初始化完毕；这样 history 闭包不需要持
 * 有 set/get 引用
 */
function patch(fn: (s: EditorState) => Partial<EditorState> | null): void {
  useEditorStore.getState().applyHistoryPatch(fn)
}

// ---------------------------------------------------------------------------
// slice
// ---------------------------------------------------------------------------

export const createSegmentsSlice: SliceCreator<
  Pick<
    EditorActions,
    | 'importScript'
    | 'editSegmentText'
    | 'deleteSegment'
    | 'reorderSegments'
    | 'setSelectedTake'
    | 'deleteTake'
    | 'splitSegmentAt'
    | 'mergeSegmentWithPrevious'
    | 'newSegment'
    | 'insertSegmentBefore'
    | 'insertSegmentAfter'
    | 'clearAllSegments'
    | 'setParagraphStart'
    | 'replaceAllInSegments'
    | 'setSegmentGap'
    | 'applyDefaultGaps'
    | 'resetGapsToDefault'
    | 'clearAutoGaps'
    | '__dev_appendFakeSegments'
  >
> = (set, get) => ({
  importScript: (rawText) => {
    const prev = get()
    const segments = splitScriptIntoSegments(rawText)
    const segmentsById: Record<string, Segment> = {}
    for (const s of segments) segmentsById[s.id] = s
    const afterOrder = segments.map((s) => s.id)
    const afterSelected = segments[0]?.id

    // importScript 是覆盖式操作：apply 写新内容、revert 完整恢复旧内容。
    // 闭包持有 before / after 完整快照——这里两份 snapshot 可能很大（几千段
    // 的工程），但 history 上限只有 100 条，单条覆盖式操作不会频繁出现，
    // 整体内存可控
    const beforeOrder = prev.order.slice()
    const beforeSegmentsById = { ...prev.segmentsById }
    const beforeSelectedSegmentId = prev.selectedSegmentId
    const afterOrderCopy = afterOrder.slice()
    const afterSegmentsByIdCopy = { ...segmentsById }

    useHistoryStore.getState().push({
      coalesceKey: 'importScript',
      labelKey: 'history.import_script',
      apply: () =>
        patch(() => ({
          order: afterOrderCopy.slice(),
          segmentsById: { ...afterSegmentsByIdCopy },
          selectedSegmentId: afterSelected
        })),
      revert: () =>
        patch(() => ({
          order: beforeOrder.slice(),
          segmentsById: { ...beforeSegmentsById },
          selectedSegmentId: beforeSelectedSegmentId
        }))
    })

    set({
      order: afterOrder,
      segmentsById,
      selectedSegmentId: afterSelected,
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  editSegmentText: (id, text) => {
    const prev = get()
    const seg = prev.segmentsById[id]
    if (!seg) return
    // 数据不变量：Segment.text 单行。任何入口（粘贴 / textarea Enter /
    // 历史遗留多行）都在这里折成空格。trim 不在 store 层做——edit 过程
    // 中的中间态可能有前后空格，trim 由 UI 在 commit / blur 时显式做
    const sanitized = sanitizeSegmentText(text)
    if (seg.text === sanitized) return
    const before = seg.text
    const after = sanitized

    const setText = (value: string): void =>
      patch((s) => {
        const cur = s.segmentsById[id]
        if (!cur) return null
        return { segmentsById: { ...s.segmentsById, [id]: { ...cur, text: value } } }
      })

    // 同一 Segment 连续打字在 coalesce 窗内合并为一条，避免每个按键一格 undo
    useHistoryStore.getState().push({
      coalesceKey: `editText:${id}`,
      labelKey: 'history.edit_text',
      apply: () => setText(after),
      revert: () => setText(before),
      mergeable: true
    })

    set({
      segmentsById: { ...prev.segmentsById, [id]: { ...seg, text: sanitized } },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  /**
   * 替换式重排：调用方传入整份新的 order 数组。
   * 既服务拖拽（UI 算好新顺序后一次性传入），也方便后续加「批量排序」等功能。
   * 我们只做长度和成员校验，防御 UI bug 把 order 污染掉。
   */
  reorderSegments: (nextOrder) => {
    const prev = get()
    if (nextOrder.length !== prev.order.length) return
    const currentSet = new Set(prev.order)
    for (const id of nextOrder) {
      if (!currentSet.has(id)) return
    }
    const same = nextOrder.every((id, i) => id === prev.order[i])
    if (same) return

    const before = prev.order.slice()
    const after = nextOrder.slice()

    useHistoryStore.getState().push({
      coalesceKey: 'reorder',
      labelKey: 'history.reorder',
      apply: () => patch(() => ({ order: after.slice() })),
      revert: () => patch(() => ({ order: before.slice() }))
    })

    set({ order: nextOrder.slice(), ...markDirty() })
    scheduleSegmentsSave()
  },

  deleteSegment: (id) => {
    const prev = get()
    const seg = prev.segmentsById[id]
    if (!seg) return
    const removedIdx = prev.order.indexOf(id)
    const nextOrder = prev.order.filter((oid) => oid !== id)
    const nextById = { ...prev.segmentsById }
    delete nextById[id]
    let nextSelected = prev.selectedSegmentId
    if (nextSelected === id) {
      nextSelected = nextOrder[removedIdx] ?? nextOrder[removedIdx - 1]
    }

    // 完整 Segment 快照（含所有 Takes）放进闭包，revert 能原样还原；
    // 即便之后 takes 被别的操作动过，这条 entry 仍然还原删除那一刻的状态
    const removedSegment = seg
    const removedIndex = removedIdx
    const prevSelected = prev.selectedSegmentId
    const nextSelectedFinal = nextSelected

    useHistoryStore.getState().push({
      coalesceKey: `deleteSegment:${id}`,
      labelKey: 'history.delete_segment',
      apply: () =>
        patch((s) => {
          const order = s.order.filter((oid) => oid !== id)
          const byId = { ...s.segmentsById }
          delete byId[id]
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: nextSelectedFinal
          }
        }),
      revert: () =>
        patch((s) => {
          const nextOrderArr = s.order.slice()
          const insertAt = Math.min(removedIndex, nextOrderArr.length)
          nextOrderArr.splice(insertAt, 0, id)
          return {
            order: nextOrderArr,
            segmentsById: { ...s.segmentsById, [id]: removedSegment },
            selectedSegmentId: prevSelected
          }
        })
    })

    set({
      order: nextOrder,
      segmentsById: nextById,
      selectedSegmentId: nextSelected,
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  setSelectedTake: (segmentId, takeId) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg || seg.selectedTakeId === takeId) return
    const before = seg.selectedTakeId
    const after = takeId

    const setSelected = (value: string | undefined): void =>
      patch((s) => {
        const cur = s.segmentsById[segmentId]
        if (!cur) return null
        return {
          segmentsById: { ...s.segmentsById, [segmentId]: { ...cur, selectedTakeId: value } }
        }
      })

    useHistoryStore.getState().push({
      coalesceKey: `setSelectedTake:${segmentId}`,
      labelKey: 'history.set_selected_take',
      apply: () => setSelected(after),
      revert: () => setSelected(before)
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [segmentId]: { ...seg, selectedTakeId: takeId }
      },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  /**
   * 删除 Take 的行为规则（见 docs/utterlane.md#Take-管理）：
   *   - 允许删除非当前 Take；selectedTakeId 不变
   *   - 允许删除当前 Take；自动修复到相邻 Take（优先后一个，否则前一个），
   *     无剩余时置空
   */
  deleteTake: (segmentId, takeId) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const removedIdx = seg.takes.findIndex((t) => t.id === takeId)
    if (removedIdx < 0) return
    const removedTake = seg.takes[removedIdx]

    const nextTakes = seg.takes.filter((t) => t.id !== takeId)
    let nextSelectedTakeId = seg.selectedTakeId
    if (nextSelectedTakeId === takeId) {
      const neighbor = nextTakes[removedIdx] ?? nextTakes[removedIdx - 1]
      nextSelectedTakeId = neighbor?.id
    }

    const prevSelectedTakeId = seg.selectedTakeId
    const nextSelectedTakeIdFinal = nextSelectedTakeId
    const takeIndex = removedIdx
    const take = removedTake

    // deleteTake 只改 segments.json，不删 WAV 文件（孤儿由专用清理工具处理）。
    // 这个设计让 undo 变得简单：revert 时 Take 引用恢复，磁盘文件原本就还在
    useHistoryStore.getState().push({
      coalesceKey: `deleteTake:${segmentId}:${takeId}`,
      labelKey: 'history.delete_take',
      apply: () =>
        patch((s) => {
          const cur = s.segmentsById[segmentId]
          if (!cur) return null
          return {
            segmentsById: {
              ...s.segmentsById,
              [segmentId]: {
                ...cur,
                takes: cur.takes.filter((t) => t.id !== takeId),
                selectedTakeId: nextSelectedTakeIdFinal
              }
            }
          }
        }),
      revert: () =>
        patch((s) => {
          const cur = s.segmentsById[segmentId]
          if (!cur) return null
          const restored = cur.takes.slice()
          restored.splice(Math.min(takeIndex, restored.length), 0, take)
          return {
            segmentsById: {
              ...s.segmentsById,
              [segmentId]: {
                ...cur,
                takes: restored,
                selectedTakeId: prevSelectedTakeId
              }
            }
          }
        })
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [segmentId]: {
          ...seg,
          takes: nextTakes,
          selectedTakeId: nextSelectedTakeId
        }
      },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  /**
   * 拆分行为：
   *   - splitAt 落在 [1, text.length-1] 才有意义；落在两端会产生空 Segment，no-op
   *   - 前半段（保留原 ID）：text[0..splitAt]，takes / selectedTakeId 不动
   *   - 后半段（新 ID）：text[splitAt..]，无 takes，紧跟原段插入
   *   - selectedSegmentId 保持原段（用户拆分通常是想精修前半段）
   * 拆分动作进 undo 栈，inverse 直接把后半段删除并合并文本回去
   */
  splitSegmentAt: (segmentId, splitAt) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const text = seg.text
    if (splitAt <= 0 || splitAt >= text.length) return
    const sourceIdx = prev.order.indexOf(segmentId)
    if (sourceIdx < 0) return

    const newSegmentId = crypto.randomUUID()
    const beforeText = text.slice(0, splitAt).trimEnd()
    const afterText = text.slice(splitAt).trimStart()
    if (beforeText.length === 0 || afterText.length === 0) return

    // 记录拆分前 source 的 gapAfter——它是「source 与下一段之间的间隔」。
    // 拆分后这个语义自然属于「后半段（新段）与原下一段之间」，所以转交给
    // 新段；前半段的 gapAfter 清零（中间是新生成的内部边界，本不该有间隔）
    const sourceGapBefore = seg.gapAfter ? { ...seg.gapAfter } : undefined
    const sourceTextBefore = text
    const newSegmentIndex = sourceIdx + 1
    const prevSelected = prev.selectedSegmentId

    useHistoryStore.getState().push({
      coalesceKey: `splitSegment:${segmentId}`,
      labelKey: 'history.split_segment',
      apply: () =>
        patch((s) => {
          const source = s.segmentsById[segmentId]
          if (!source) return null
          const front = { ...source, text: beforeText }
          delete front.gapAfter
          const newSegment: Segment = {
            id: newSegmentId,
            text: afterText,
            takes: []
          }
          if (sourceGapBefore) newSegment.gapAfter = { ...sourceGapBefore }
          const order = s.order.slice()
          order.splice(newSegmentIndex, 0, newSegmentId)
          return {
            order,
            segmentsById: {
              ...s.segmentsById,
              [segmentId]: front,
              [newSegmentId]: newSegment
            },
            selectedSegmentId: prevSelected
          }
        }),
      revert: () =>
        patch((s) => {
          const source = s.segmentsById[segmentId]
          if (!source) return null
          const restored = { ...source, text: sourceTextBefore }
          if (sourceGapBefore) restored.gapAfter = { ...sourceGapBefore }
          else delete restored.gapAfter
          const order = s.order.filter((id) => id !== newSegmentId)
          const byId = { ...s.segmentsById }
          delete byId[newSegmentId]
          byId[segmentId] = restored
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: prevSelected
          }
        })
    })

    const nextOrder = prev.order.slice()
    nextOrder.splice(sourceIdx + 1, 0, newSegmentId)
    const frontSegment = { ...seg, text: beforeText }
    delete frontSegment.gapAfter
    const newSegment: Segment = { id: newSegmentId, text: afterText, takes: [] }
    if (sourceGapBefore) newSegment.gapAfter = sourceGapBefore
    set({
      order: nextOrder,
      segmentsById: {
        ...prev.segmentsById,
        [segmentId]: frontSegment,
        [newSegmentId]: newSegment
      },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  /**
   * 合并行为：
   *   - 必须存在「前一段」（segmentId 在 order 中 idx > 0），否则 no-op
   *   - 文本：`${prev.text} ${curr.text}`（中间加空格；不区分中英文,
   *     用户合完可以再编辑）。两端先 trim 避免多余空白
   *   - takes：append curr.takes 到 prev.takes 末尾。selectedTakeId 不动
   *     （前一段原本选哪个还选哪个）
   *   - selectedSegmentId 切到 target（前一段），让 Inspector 立刻显示合完的文本
   */
  mergeSegmentWithPrevious: (segmentId) => {
    const prev = get()
    const idx = prev.order.indexOf(segmentId)
    if (idx <= 0) return
    const targetId = prev.order[idx - 1]
    const target = prev.segmentsById[targetId]
    const curr = prev.segmentsById[segmentId]
    if (!target || !curr) return

    const targetTextBefore = target.text
    const targetTakesBefore = target.takes
    const targetGapBefore = target.gapAfter ? { ...target.gapAfter } : undefined
    const mergedText = `${target.text.trim()} ${curr.text.trim()}`.trim()
    const mergedSegment = curr
    const mergedIndex = idx
    const prevSelected = prev.selectedSegmentId

    useHistoryStore.getState().push({
      coalesceKey: `mergeSegment:${segmentId}`,
      labelKey: 'history.merge_segment',
      apply: () =>
        patch((s) => {
          const tgt = s.segmentsById[targetId]
          if (!tgt) return null
          const order = s.order.filter((id) => id !== segmentId)
          const byId = { ...s.segmentsById }
          delete byId[segmentId]
          const merged = {
            ...tgt,
            text: mergedText,
            takes: [...targetTakesBefore, ...mergedSegment.takes]
          }
          if (mergedSegment.gapAfter) merged.gapAfter = { ...mergedSegment.gapAfter }
          else delete merged.gapAfter
          byId[targetId] = merged
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: targetId
          }
        }),
      revert: () =>
        patch((s) => {
          const tgt = s.segmentsById[targetId]
          if (!tgt) return null
          const order = s.order.slice()
          order.splice(mergedIndex, 0, mergedSegment.id)
          const restoredTarget = {
            ...tgt,
            text: targetTextBefore,
            takes: targetTakesBefore
          }
          if (targetGapBefore) restoredTarget.gapAfter = { ...targetGapBefore }
          else delete restoredTarget.gapAfter
          return {
            order,
            segmentsById: {
              ...s.segmentsById,
              [targetId]: restoredTarget,
              [mergedSegment.id]: mergedSegment
            },
            selectedSegmentId: prevSelected
          }
        })
    })

    const nextOrder = prev.order.filter((id) => id !== segmentId)
    const nextById = { ...prev.segmentsById }
    delete nextById[segmentId]
    const mergedTarget = {
      ...target,
      text: mergedText,
      takes: [...targetTakesBefore, ...curr.takes]
    }
    if (curr.gapAfter) mergedTarget.gapAfter = { ...curr.gapAfter }
    else delete mergedTarget.gapAfter
    nextById[targetId] = mergedTarget
    set({
      order: nextOrder,
      segmentsById: nextById,
      selectedSegmentId: targetId,
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  newSegment: (text) => {
    const prev = get()
    const newId = crypto.randomUUID()
    const seg: Segment = { id: newId, text: text ?? '', takes: [] }
    const insertIdx = prev.order.length
    const prevSelected = prev.selectedSegmentId
    const insertedSegment = seg

    useHistoryStore.getState().push({
      coalesceKey: `insertSegment:${newId}`,
      labelKey: 'history.insert_segment',
      apply: () =>
        patch((s) => {
          const order = s.order.slice()
          order.splice(Math.min(insertIdx, order.length), 0, newId)
          return {
            order,
            segmentsById: { ...s.segmentsById, [newId]: insertedSegment },
            selectedSegmentId: newId
          }
        }),
      revert: () =>
        patch((s) => {
          const order = s.order.filter((id) => id !== newId)
          const byId = { ...s.segmentsById }
          delete byId[newId]
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: prevSelected
          }
        })
    })

    set({
      order: [...prev.order, newId],
      segmentsById: { ...prev.segmentsById, [newId]: seg },
      selectedSegmentId: newId,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
    return newId
  },

  insertSegmentBefore: (refId, text) => {
    const prev = get()
    const refIdx = prev.order.indexOf(refId)
    if (refIdx < 0) return null
    const newId = crypto.randomUUID()
    const seg: Segment = { id: newId, text: text ?? '', takes: [] }
    const insertIdx = refIdx
    const prevSelected = prev.selectedSegmentId
    const insertedSegment = seg

    useHistoryStore.getState().push({
      coalesceKey: `insertSegment:${newId}`,
      labelKey: 'history.insert_segment_before',
      apply: () =>
        patch((s) => {
          const order = s.order.slice()
          order.splice(Math.min(insertIdx, order.length), 0, newId)
          return {
            order,
            segmentsById: { ...s.segmentsById, [newId]: insertedSegment },
            selectedSegmentId: newId
          }
        }),
      revert: () =>
        patch((s) => {
          const order = s.order.filter((id) => id !== newId)
          const byId = { ...s.segmentsById }
          delete byId[newId]
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: prevSelected
          }
        })
    })

    const nextOrder = prev.order.slice()
    nextOrder.splice(refIdx, 0, newId)
    set({
      order: nextOrder,
      segmentsById: { ...prev.segmentsById, [newId]: seg },
      selectedSegmentId: newId,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
    return newId
  },

  insertSegmentAfter: (refId, text) => {
    const prev = get()
    const refIdx = prev.order.indexOf(refId)
    if (refIdx < 0) return null
    const newId = crypto.randomUUID()
    const seg: Segment = { id: newId, text: text ?? '', takes: [] }
    const insertIdx = refIdx + 1
    const prevSelected = prev.selectedSegmentId
    const insertedSegment = seg

    useHistoryStore.getState().push({
      coalesceKey: `insertSegment:${newId}`,
      labelKey: 'history.insert_segment_after',
      apply: () =>
        patch((s) => {
          const order = s.order.slice()
          order.splice(Math.min(insertIdx, order.length), 0, newId)
          return {
            order,
            segmentsById: { ...s.segmentsById, [newId]: insertedSegment },
            selectedSegmentId: newId
          }
        }),
      revert: () =>
        patch((s) => {
          const order = s.order.filter((id) => id !== newId)
          const byId = { ...s.segmentsById }
          delete byId[newId]
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: prevSelected
          }
        })
    })

    const nextOrder = prev.order.slice()
    nextOrder.splice(refIdx + 1, 0, newId)
    set({
      order: nextOrder,
      segmentsById: { ...prev.segmentsById, [newId]: seg },
      selectedSegmentId: newId,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
    return newId
  },

  clearAllSegments: () => {
    const prev = get()
    if (prev.order.length === 0) return

    const beforeOrder = prev.order.slice()
    const beforeSegmentsById = { ...prev.segmentsById }
    const beforeSelectedSegmentId = prev.selectedSegmentId

    useHistoryStore.getState().push({
      coalesceKey: 'clearSegments',
      labelKey: 'history.clear_segments',
      apply: () =>
        patch(() => ({
          order: [],
          segmentsById: {},
          selectedSegmentId: undefined
        })),
      revert: () =>
        patch(() => ({
          order: beforeOrder.slice(),
          segmentsById: { ...beforeSegmentsById },
          selectedSegmentId: beforeSelectedSegmentId
        }))
    })

    set({
      order: [],
      segmentsById: {},
      selectedSegmentId: undefined,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  setParagraphStart: (segmentId, value) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const before = seg.paragraphStart
    if (!!before === value) return

    const writeFlag = (flag: boolean | undefined): void =>
      patch((s) => {
        const cur = s.segmentsById[segmentId]
        if (!cur) return null
        const next = { ...cur }
        if (flag) next.paragraphStart = true
        else delete next.paragraphStart
        return { segmentsById: { ...s.segmentsById, [segmentId]: next } }
      })

    useHistoryStore.getState().push({
      coalesceKey: `setParagraphStart:${segmentId}`,
      labelKey: 'history.set_paragraph_start',
      apply: () => writeFlag(value),
      revert: () => writeFlag(before)
    })

    const nextSeg = { ...seg }
    if (value) nextSeg.paragraphStart = true
    else delete nextSeg.paragraphStart
    set({
      segmentsById: { ...prev.segmentsById, [segmentId]: nextSeg },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  setSegmentGap: (segmentId, gap) => {
    const prev = get()
    const seg = prev.segmentsById[segmentId]
    if (!seg) return
    const before = seg.gapAfter ? { ...seg.gapAfter } : undefined
    if (gapEquals(seg.gapAfter, gap)) return
    const after = gap ? { ...gap } : undefined

    const writeGap = (value: { ms: number; manual?: boolean } | undefined): void =>
      patch((s) => {
        const cur = s.segmentsById[segmentId]
        if (!cur) return null
        const next = { ...cur }
        if (value && value.ms > 0) next.gapAfter = { ms: value.ms, manual: value.manual }
        else delete next.gapAfter
        return { segmentsById: { ...s.segmentsById, [segmentId]: next } }
      })

    // coalesceKey 加 segId 后缀：连续拖拽同一段的 spacer 时合并成一格 undo；
    // 切到别段拖拽则开新条目
    useHistoryStore.getState().push({
      coalesceKey: `setSegmentGap:${segmentId}`,
      labelKey: 'history.set_segment_gap',
      apply: () => writeGap(after),
      revert: () => writeGap(before),
      mergeable: true
    })

    const nextSeg = { ...seg }
    if (gap && gap.ms > 0) nextSeg.gapAfter = { ms: gap.ms, manual: gap.manual }
    else delete nextSeg.gapAfter
    set({
      segmentsById: { ...prev.segmentsById, [segmentId]: nextSeg },
      ...markDirty()
    })
    scheduleSegmentsSave()
  },

  resetGapsToDefault: (defaults) => {
    const prev = get()
    if (prev.order.length <= 1) return
    const edits = collectGapEdits(prev, defaults, /* skipManual */ false)
    if (edits.length === 0) return

    pushGapBatch(edits, 'resetGapsToDefault', 'history.reset_gaps_to_default')
    applyGapBatchInline(prev, set, edits)
  },

  clearAutoGaps: () => {
    const prev = get()
    const edits: GapEdit[] = []
    for (const segId of prev.order) {
      const seg = prev.segmentsById[segId]
      if (!seg) continue
      // 只清非 manual 的；没设 gapAfter 的也跳过（无可清）
      if (!seg.gapAfter || seg.gapAfter.manual) continue
      edits.push({
        segId,
        before: { ...seg.gapAfter },
        after: undefined
      })
    }
    if (edits.length === 0) return

    pushGapBatch(edits, 'clearAutoGaps', 'history.clear_auto_gaps')
    applyGapBatchInline(prev, set, edits)
  },

  applyDefaultGaps: (defaults) => {
    const prev = get()
    if (prev.order.length <= 1) return
    const edits = collectGapEdits(prev, defaults, /* skipManual */ true)
    if (edits.length === 0) return

    pushGapBatch(edits, 'applyDefaultGaps', 'history.apply_default_gaps')
    applyGapBatchInline(prev, set, edits)
  },

  replaceAllInSegments: (find, replaceWith) => {
    if (find.length === 0) return 0
    const prev = get()
    const edits: Array<{ segId: string; before: string; after: string }> = []
    for (const id of prev.order) {
      const seg = prev.segmentsById[id]
      if (!seg) continue
      if (!seg.text.includes(find)) continue
      // split + join 比 replaceAll 快，且不依赖 RegExp 转义
      const after = seg.text.split(find).join(replaceWith)
      if (after === seg.text) continue
      edits.push({ segId: id, before: seg.text, after })
    }
    if (edits.length === 0) return 0

    const editsCopy = edits.map((e) => ({ ...e }))
    useHistoryStore.getState().push({
      coalesceKey: 'replaceAll',
      labelKey: 'history.replace_all',
      apply: () =>
        patch((s) => {
          const byId = { ...s.segmentsById }
          for (const e of editsCopy) {
            const cur = byId[e.segId]
            if (cur) byId[e.segId] = { ...cur, text: e.after }
          }
          return { segmentsById: byId }
        }),
      revert: () =>
        patch((s) => {
          const byId = { ...s.segmentsById }
          for (const e of editsCopy) {
            const cur = byId[e.segId]
            if (cur) byId[e.segId] = { ...cur, text: e.before }
          }
          return { segmentsById: byId }
        })
    })

    const nextById = { ...prev.segmentsById }
    for (const e of edits) {
      const seg = nextById[e.segId]
      if (seg) nextById[e.segId] = { ...seg, text: e.after }
    }
    set({ segmentsById: nextById, ...markDirty() })
    scheduleSegmentsSave()
    return edits.length
  },

  __dev_appendFakeSegments: (count) => {
    // 生产构建下整个分支应当被 tree-shake：Titlebar 调用入口包在
    // import.meta.env.DEV 内已经会被剥离，但 store 本身的方法实现仍会进
    // 包。再加一道运行期 guard 双保险——万一有第三方代码（未来的插件 /
    // 调试工具）遍历 store action 调到，也不会污染生产数据
    if (!import.meta.env.DEV) return
    const prev = get()
    const newSegs: Segment[] = []
    for (let i = 0; i < count; i++) {
      const idx = prev.order.length + i + 1
      newSegs.push({
        id: crypto.randomUUID(),
        text: `[Dev] Segment ${idx} - Lorem ipsum dolor sit amet, consectetur adipiscing elit ${idx}.`,
        takes: []
      })
    }
    const nextById = { ...prev.segmentsById }
    for (const s of newSegs) nextById[s.id] = s
    set({
      order: [...prev.order, ...newSegs.map((s) => s.id)],
      segmentsById: nextById,
      ...markDirty()
    })
    scheduleSegmentsSave()
  }
})

// ---------------------------------------------------------------------------
// gap 批量编辑共享逻辑：apply/reset/clear 三个 action 都走相同的 edits 形态
// ---------------------------------------------------------------------------

type GapEdit = {
  segId: string
  before: { ms: number; manual?: boolean } | undefined
  after: { ms: number; manual?: boolean } | undefined
}

/**
 * 按当前 order 计算出每段应当生效的 gap，返回与现状不同的 edits。
 * skipManual = true 时跳过用户手动设过的段；false 时一视同仁覆盖。
 */
function collectGapEdits(
  state: EditorState,
  defaults: { sentenceMs: number; paragraphMs: number },
  skipManual: boolean
): GapEdit[] {
  const edits: GapEdit[] = []
  for (let i = 0; i < state.order.length; i++) {
    const segId = state.order[i]
    const seg = state.segmentsById[segId]
    if (!seg) continue
    // 最后一段的 gapAfter 在拼接里无意义，不写
    if (i === state.order.length - 1) continue
    if (skipManual && seg.gapAfter?.manual) continue

    // 决定句间还是段间：依据「下一段是否为段首」
    const next = state.segmentsById[state.order[i + 1]]
    const isParagraphBoundary = !!next?.paragraphStart
    const ms = isParagraphBoundary ? defaults.paragraphMs : defaults.sentenceMs
    const newGap = ms > 0 ? { ms } : undefined

    if (gapEquals(seg.gapAfter, newGap)) continue
    edits.push({
      segId,
      before: seg.gapAfter ? { ...seg.gapAfter } : undefined,
      after: newGap
    })
  }
  return edits
}

function pushGapBatch(edits: GapEdit[], coalesceKey: string, labelKey: string): void {
  const editsCopy = edits.map((e) => ({
    segId: e.segId,
    before: e.before ? { ...e.before } : undefined,
    after: e.after ? { ...e.after } : undefined
  }))
  useHistoryStore.getState().push({
    coalesceKey,
    labelKey,
    apply: () =>
      patch((s) => {
        const byId = { ...s.segmentsById }
        for (const e of editsCopy) {
          const seg = byId[e.segId]
          if (!seg) continue
          const next = { ...seg }
          if (e.after) next.gapAfter = { ...e.after }
          else delete next.gapAfter
          byId[e.segId] = next
        }
        return { segmentsById: byId }
      }),
    revert: () =>
      patch((s) => {
        const byId = { ...s.segmentsById }
        for (const e of editsCopy) {
          const seg = byId[e.segId]
          if (!seg) continue
          const next = { ...seg }
          if (e.before) next.gapAfter = { ...e.before }
          else delete next.gapAfter
          byId[e.segId] = next
        }
        return { segmentsById: byId }
      })
  })
}

/** 把 edits 直接应用到当前 state（push 之后的初始 mutation） */
function applyGapBatchInline(
  prev: EditorState,
  set: (partial: Partial<EditorState>) => void,
  edits: GapEdit[]
): void {
  const nextById = { ...prev.segmentsById }
  for (const e of edits) {
    const seg = nextById[e.segId]
    if (!seg) continue
    const nextSeg = { ...seg }
    if (e.after) nextSeg.gapAfter = { ...e.after }
    else delete nextSeg.gapAfter
    nextById[e.segId] = nextSeg
  }
  set({ segmentsById: nextById, ...markDirty() })
  scheduleSegmentsSave()
}
