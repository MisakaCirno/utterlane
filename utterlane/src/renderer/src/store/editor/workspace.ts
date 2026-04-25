import type { Segment } from '@renderer/types/project'
import { useHistoryStore } from '@renderer/store/historyStore'
import { useEditorStore } from '@renderer/store/editorStore'
import type { EditorActions, EditorState, SliceCreator } from './types'
import { markDirty, pushWorkspace, scheduleSegmentsSave } from './save'

function patch(fn: (s: EditorState) => Partial<EditorState> | null): void {
  useEditorStore.getState().applyHistoryPatch(fn)
}

/**
 * 工作区 slice：选择 / 滚动 / 缩放 / playback 状态字段写入。
 *
 * 这一组的共同特点是：动作会改 workspace.json 落盘的字段（selected /
 * scroll / zoom），或者纯 UI 状态（playback、extraSelectedSegmentIds）。
 * 唯一进 undo 栈的是 deleteSelectedSegments——它属于「批量选中后删除」的
 * 选择维度操作，留在这里和单条 deleteSegment（在 segments slice）形成
 * 入口对照。
 */
export const createWorkspaceSlice: SliceCreator<
  Pick<
    EditorActions,
    | 'selectSegment'
    | 'selectSegmentExtended'
    | 'clearExtraSelection'
    | 'deleteSelectedSegments'
    | 'setPlayback'
    | 'setScriptListScrollTop'
    | 'setTimelineScroll'
    | 'setTimelinePlayhead'
    | 'setWaveformZoom'
  >
> = (set, get) => ({
  selectSegment: (id) => {
    // 普通选中也清空副选——保持「主选变化时副选不孤立」的语义
    set({ selectedSegmentId: id, extraSelectedSegmentIds: new Set() })
    pushWorkspace(get())
  },

  selectSegmentExtended: (id, mode) => {
    const state = get()
    if (mode === 'single') {
      set({ selectedSegmentId: id, extraSelectedSegmentIds: new Set() })
      pushWorkspace(get())
      return
    }
    if (mode === 'toggle') {
      // Ctrl/Cmd+Click：在副选中里加 / 减，主选不变。但如果点的就是当前主选，
      // 则保持主选不动（用户可能在矫正误操作）。如果之前没主选，把 id 设为主选
      if (!state.selectedSegmentId) {
        set({ selectedSegmentId: id })
        pushWorkspace(get())
        return
      }
      if (id === state.selectedSegmentId) return
      const next = new Set(state.extraSelectedSegmentIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      set({ extraSelectedSegmentIds: next })
      return
    }
    // mode === 'range'：从当前主选到 id 的连续区间全部进副选，id 成为新的主选。
    // 没有主选时退化成 single
    if (!state.selectedSegmentId) {
      set({ selectedSegmentId: id, extraSelectedSegmentIds: new Set() })
      pushWorkspace(get())
      return
    }
    const fromIdx = state.order.indexOf(state.selectedSegmentId)
    const toIdx = state.order.indexOf(id)
    if (fromIdx < 0 || toIdx < 0) return
    const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
    const range = state.order.slice(lo, hi + 1)
    const next = new Set(range)
    next.delete(id) // id 是新主选，不进副选集合
    set({ selectedSegmentId: id, extraSelectedSegmentIds: next })
    pushWorkspace(get())
  },

  clearExtraSelection: () => {
    if (get().extraSelectedSegmentIds.size === 0) return
    set({ extraSelectedSegmentIds: new Set() })
  },

  deleteSelectedSegments: () => {
    const prev = get()
    // 主选 + 副选合并成完整的待删 ID 集合
    const targetIds = new Set(prev.extraSelectedSegmentIds)
    if (prev.selectedSegmentId) targetIds.add(prev.selectedSegmentId)
    if (targetIds.size === 0) return

    // 收集每个待删 Segment 在原 order 中的下标，排序后塞进命令的 removed
    const removed: Array<{ index: number; segment: Segment }> = []
    for (let i = 0; i < prev.order.length; i++) {
      const id = prev.order[i]
      if (targetIds.has(id)) {
        const seg = prev.segmentsById[id]
        if (seg) removed.push({ index: i, segment: seg })
      }
    }
    if (removed.length === 0) return

    // 计算删除后的主选：取被删除区域的下一个未删段；都没有就向前找
    const firstRemovedIdx = removed[0].index
    let nextSelected: string | undefined
    for (let i = firstRemovedIdx; i < prev.order.length; i++) {
      if (!targetIds.has(prev.order[i])) {
        nextSelected = prev.order[i]
        break
      }
    }
    if (!nextSelected) {
      for (let i = firstRemovedIdx - 1; i >= 0; i--) {
        if (!targetIds.has(prev.order[i])) {
          nextSelected = prev.order[i]
          break
        }
      }
    }

    const removedSnapshot = removed.map((r) => ({ index: r.index, segment: r.segment }))
    const removedIdsSet = new Set(removedSnapshot.map((r) => r.segment.id))
    const prevSelected = prev.selectedSegmentId
    const nextSelectedFinal = nextSelected

    useHistoryStore.getState().push({
      coalesceKey: `deleteSegmentsBatch:${removed.length}`,
      labelKey: 'history.delete_segments_batch',
      apply: () =>
        patch((s) => {
          const byId = { ...s.segmentsById }
          for (const id of removedIdsSet) delete byId[id]
          return {
            order: s.order.filter((id) => !removedIdsSet.has(id)),
            segmentsById: byId,
            selectedSegmentId: nextSelectedFinal
          }
        }),
      revert: () =>
        patch((s) => {
          // 把每条 removed 按 index 升序逐个 splice 回 order；index 是删除前的
          // 下标，按升序处理保证插入位置正确——前面 splice 后续 index 都偏移 +1，
          // 但每条 r.index 也是按删除前的下标，因此直接用 r.index 即可
          const byId = { ...s.segmentsById }
          for (const r of removedSnapshot) byId[r.segment.id] = r.segment
          const order = s.order.slice()
          const sorted = removedSnapshot.slice().sort((a, b) => a.index - b.index)
          for (const r of sorted) {
            order.splice(Math.min(r.index, order.length), 0, r.segment.id)
          }
          return {
            order,
            segmentsById: byId,
            selectedSegmentId: prevSelected
          }
        })
    })

    const nextById = { ...prev.segmentsById }
    for (const { segment } of removed) delete nextById[segment.id]
    set({
      order: prev.order.filter((id) => !targetIds.has(id)),
      segmentsById: nextById,
      selectedSegmentId: nextSelected,
      extraSelectedSegmentIds: new Set(),
      ...markDirty()
    })
    scheduleSegmentsSave()
    pushWorkspace(get())
  },

  setPlayback: (mode) => set({ playback: mode } as Partial<EditorState>),

  setScriptListScrollTop: (top) => {
    set({ scriptListScrollTop: top })
    pushWorkspace(get())
  },

  setTimelineScroll: (left, zoom) => {
    set({ timelineScrollLeft: left, ...(zoom !== undefined && { timelineZoom: zoom }) })
    pushWorkspace(get())
  },

  setTimelinePlayhead: (ms) => {
    const next = Math.max(0, ms)
    if (get().timelinePlayheadMs === next) return
    set({ timelinePlayheadMs: next })
    pushWorkspace(get())
  },

  setWaveformZoom: (patch) => {
    const state = get()
    const nextH = patch.h ?? state.waveformZoomH
    const nextV = patch.v ?? state.waveformZoomV
    if (nextH === state.waveformZoomH && nextV === state.waveformZoomV) return
    set({ waveformZoomH: nextH, waveformZoomV: nextV })
    pushWorkspace(get())
  }
})
