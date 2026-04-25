import type { Segment } from '@renderer/types/project'
import { useHistoryStore } from '@renderer/store/historyStore'
import type { EditorActions, SliceCreator } from './types'
import { markDirty, pushWorkspace, scheduleSegmentsSave } from './save'

/**
 * Segment / Take / Gap / Paragraph 的全部 mutation。
 *
 * 所有动作满足同一组副作用约定：
 *   - 通过 historyStore.push(...) 进 undo 栈（少数纯调试动作除外）
 *   - 写入 markDirty() 标记 + 调 scheduleSegmentsSave 触发 200ms debounce 落盘
 *   - 改 selectedSegmentId 时附带 pushWorkspace 让 workspace.json 同步
 *
 * 切分依据：所有 segment / take / gap / paragraph 的字段都属于工程内容
 * （segments.json 范畴），共享同一套副作用。把它们集中到一个 slice 既不
 * 拆得过碎，也方便 #19 改 history push API 时一次性更新这一组调用。
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

    // importScript 是覆盖式操作，before / after 都要完整记录；
    // 未来改成追加式时只需换这一处的 before / after 构造方式，命令类型不用动
    useHistoryStore.getState().push('importScript', 'history.import_script', {
      type: 'importScript',
      beforeOrder: prev.order.slice(),
      beforeSegmentsById: { ...prev.segmentsById },
      beforeSelectedSegmentId: prev.selectedSegmentId,
      afterOrder: afterOrder.slice(),
      afterSegmentsById: { ...segmentsById },
      afterSelectedSegmentId: afterSelected
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

    // 同一 Segment 连续打字在 coalesce 窗内合并为一条，避免每个按键一格 undo
    useHistoryStore.getState().push(`editText:${id}`, 'history.edit_text', {
      type: 'editText',
      segId: id,
      before: seg.text,
      after: sanitized
    })

    set({
      segmentsById: {
        ...prev.segmentsById,
        [id]: { ...seg, text: sanitized }
      },
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
    // 成员必须和旧 order 完全一致，仅顺序不同
    const currentSet = new Set(prev.order)
    for (const id of nextOrder) {
      if (!currentSet.has(id)) return
    }
    // 顺序未变则不写盘，也不入栈
    const same = nextOrder.every((id, i) => id === prev.order[i])
    if (same) return

    useHistoryStore.getState().push('reorder', 'history.reorder', {
      type: 'reorder',
      before: prev.order.slice(),
      after: nextOrder.slice()
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
    // 选中态跟随：若删除的是当前选中段，自动选相邻段（优先后一个，没有就前一个，都没有就清空）
    let nextSelected = prev.selectedSegmentId
    if (nextSelected === id) {
      nextSelected = nextOrder[removedIdx] ?? nextOrder[removedIdx - 1]
    }

    // 保存完整 Segment（含所有 Takes），这样 undo 能原样还原；
    // 即便之后 takes 被别的操作动过，这个 cmd 依然还原删除那一刻的状态
    useHistoryStore.getState().push(`deleteSegment:${id}`, 'history.delete_segment', {
      type: 'deleteSegment',
      id,
      index: removedIdx,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: nextSelected
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

    useHistoryStore.getState().push(`setSelectedTake:${segmentId}`, 'history.set_selected_take', {
      type: 'setSelectedTake',
      segId: segmentId,
      before: seg.selectedTakeId,
      after: takeId
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

    // deleteTake 只改 segments.json，不删 WAV 文件（孤儿由专用清理工具处理）。
    // 这个设计让 undo 变得简单：revert 时 Take 引用恢复，磁盘文件原本就还在，
    // 不需要做任何 IO
    useHistoryStore.getState().push(`deleteTake:${segmentId}:${takeId}`, 'history.delete_take', {
      type: 'deleteTake',
      segId: segmentId,
      takeIndex: removedIdx,
      take: removedTake,
      prevSelectedTakeId: seg.selectedTakeId,
      nextSelectedTakeId
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
    // 越界保护：拆分点必须落在文本中段，否则一段空一段全的拆没意义
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

    useHistoryStore.getState().push(`splitSegment:${segmentId}`, 'history.split_segment', {
      type: 'splitSegment',
      sourceSegmentId: segmentId,
      sourceTextBefore: text,
      splitAt,
      sourceGapBefore,
      newSegmentId,
      newSegmentIndex: sourceIdx + 1,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: prev.selectedSegmentId
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
   *   - 文本：`${prev.text} ${curr.text}`（中间加空格；不区分中英文，
   *     用户合完可以再编辑）。两端先 trim 避免多余空白
   *   - takes：append curr.takes 到 prev.takes 末尾。selectedTakeId 不动
   *     （前一段原本选哪个还选哪个）
   *   - selectedSegmentId 切到 target（前一段），让 Inspector 立刻显示合完的文本
   */
  mergeSegmentWithPrevious: (segmentId) => {
    const prev = get()
    const idx = prev.order.indexOf(segmentId)
    if (idx <= 0) return // 已经是首段，无前一段可合
    const targetId = prev.order[idx - 1]
    const target = prev.segmentsById[targetId]
    const curr = prev.segmentsById[segmentId]
    if (!target || !curr) return

    const targetTextBefore = target.text
    const targetTakesBefore = target.takes
    const targetGapBefore = target.gapAfter ? { ...target.gapAfter } : undefined
    const mergedText = `${target.text.trim()} ${curr.text.trim()}`.trim()

    useHistoryStore.getState().push(`mergeSegment:${segmentId}`, 'history.merge_segment', {
      type: 'mergeSegment',
      targetSegmentId: targetId,
      targetTextBefore,
      targetTextAfter: mergedText,
      targetTakesBefore,
      targetGapBefore,
      mergedSegment: curr,
      mergedIndex: idx,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: targetId
    })

    const nextOrder = prev.order.filter((id) => id !== segmentId)
    const nextById = { ...prev.segmentsById }
    delete nextById[segmentId]
    // merged 体的 gapAfter 接管 curr 的（= 合并体到下一段的间隔）；
    // target 原来的 gapAfter（= target → curr 的内部边界）随合并消失
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
    useHistoryStore.getState().push(`insertSegment:${newId}`, 'history.insert_segment', {
      type: 'insertSegment',
      index: insertIdx,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: newId
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
    useHistoryStore.getState().push(`insertSegment:${newId}`, 'history.insert_segment_before', {
      type: 'insertSegment',
      index: refIdx,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: newId
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
    useHistoryStore.getState().push(`insertSegment:${newId}`, 'history.insert_segment_after', {
      type: 'insertSegment',
      index: refIdx + 1,
      segment: seg,
      prevSelectedSegmentId: prev.selectedSegmentId,
      nextSelectedSegmentId: newId
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
    useHistoryStore.getState().push('clearSegments', 'history.clear_segments', {
      type: 'clearSegments',
      beforeOrder: prev.order.slice(),
      beforeSegmentsById: { ...prev.segmentsById },
      beforeSelectedSegmentId: prev.selectedSegmentId
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
    // before 实际是 boolean | undefined；和目标值都规范成 boolean 再比较
    if (!!before === value) return
    useHistoryStore
      .getState()
      .push(`setParagraphStart:${segmentId}`, 'history.set_paragraph_start', {
        type: 'setParagraphStart',
        segId: segmentId,
        before,
        after: value
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
    const before = seg.gapAfter
    if (gapEquals(before, gap)) return

    // coalesceKey 加 segId 后缀：连续拖拽同一段的 spacer 时合并成一格 undo；
    // 切到别段拖拽则开新条目
    useHistoryStore.getState().push(`setSegmentGap:${segmentId}`, 'history.set_segment_gap', {
      type: 'setSegmentGap',
      segId: segmentId,
      before: before ? { ...before } : undefined,
      after: gap ? { ...gap } : undefined
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
    const edits: Array<{
      segId: string
      before: { ms: number; manual?: boolean } | undefined
      after: { ms: number; manual?: boolean } | undefined
    }> = []

    for (let i = 0; i < prev.order.length; i++) {
      const segId = prev.order[i]
      const seg = prev.segmentsById[segId]
      if (!seg) continue
      if (i === prev.order.length - 1) continue // 最后一段无意义
      const next = prev.segmentsById[prev.order[i + 1]]
      const isParagraphBoundary = !!next?.paragraphStart
      const ms = isParagraphBoundary ? defaults.paragraphMs : defaults.sentenceMs
      // reset 写入的是「非 manual 的默认值」——清掉 manual 标志，让下次
      // applyDefaultGaps 还能继续覆盖它
      const newGap = ms > 0 ? { ms } : undefined

      if (gapEquals(seg.gapAfter, newGap)) continue
      edits.push({
        segId,
        before: seg.gapAfter ? { ...seg.gapAfter } : undefined,
        after: newGap
      })
    }
    if (edits.length === 0) return

    useHistoryStore.getState().push('resetGapsToDefault', 'history.reset_gaps_to_default', {
      type: 'applyDefaultGaps',
      edits
    })

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
  },

  clearAutoGaps: () => {
    const prev = get()
    const edits: Array<{
      segId: string
      before: { ms: number; manual?: boolean } | undefined
      after: { ms: number; manual?: boolean } | undefined
    }> = []
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

    useHistoryStore.getState().push('clearAutoGaps', 'history.clear_auto_gaps', {
      type: 'applyDefaultGaps',
      edits
    })

    const nextById = { ...prev.segmentsById }
    for (const e of edits) {
      const seg = nextById[e.segId]
      if (!seg) continue
      const nextSeg = { ...seg }
      delete nextSeg.gapAfter
      nextById[e.segId] = nextSeg
    }
    set({ segmentsById: nextById, ...markDirty() })
    scheduleSegmentsSave()
  },

  applyDefaultGaps: (defaults) => {
    const prev = get()
    if (prev.order.length <= 1) return
    const edits: Array<{
      segId: string
      before: { ms: number; manual?: boolean } | undefined
      after: { ms: number; manual?: boolean } | undefined
    }> = []

    for (let i = 0; i < prev.order.length; i++) {
      const segId = prev.order[i]
      const seg = prev.segmentsById[segId]
      if (!seg) continue
      // 最后一段的 gapAfter 在拼接里无意义，不写
      if (i === prev.order.length - 1) continue
      // 用户手动设过的不动
      if (seg.gapAfter?.manual) continue

      // 决定句间还是段间：依据「下一段是否为段首」
      const next = prev.segmentsById[prev.order[i + 1]]
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

    if (edits.length === 0) return

    useHistoryStore.getState().push('applyDefaultGaps', 'history.apply_default_gaps', {
      type: 'applyDefaultGaps',
      edits
    })

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

    useHistoryStore.getState().push('replaceAll', 'history.replace_all', {
      type: 'replaceAll',
      find,
      replaceWith,
      edits
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
