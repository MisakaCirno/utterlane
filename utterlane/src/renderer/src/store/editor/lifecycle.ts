import type { Project } from '@renderer/types/project'
import { showError } from '@renderer/store/toastStore'
import { useHistoryStore } from '@renderer/store/historyStore'
import i18n from '@renderer/i18n'
import { INITIAL_DATA, type EditorActions, type EditorState, type SliceCreator } from './types'
import { cancelPendingSegmentsSave, markDirty, pushWorkspace, scheduleSegmentsSave } from './save'

/**
 * 生命周期 + 工程元 + 审计回调 slice。
 *
 * 这一组 action 共享「会话级 / 跨整 store」语义：开/关工程、覆盖 store
 * 内存模型、提交外部修复结果。它们的副作用模式也一致——applyBundle 会
 * 重置全部字段，clear 走相同的初值 spread，audit 三件套走 markDirty +
 * scheduleSegmentsSave。
 *
 * applyHistoryPatch 也归这里：它是 historyStore 调过来的入口，从生命周期
 * 视角看就是「外部对内存做一次 batch 修改」，与录音 / 选择等具体动作无关。
 */
export const createLifecycleSlice: SliceCreator<
  Pick<
    EditorActions,
    | 'applyBundle'
    | 'clear'
    | 'updateProject'
    | 'applyHistoryPatch'
    | 'setMissingTakeIds'
    | 'applyRemapResult'
    | 'appendTakeFromOrphan'
  >
> = (set, get) => ({
  applyBundle: (bundle) => {
    // 切换工程必须清空 undo / redo 栈，否则新工程头一次按 Ctrl+Z 会把上个工程
    // 遗留的 deleteSegment 命令应用到当前 segmentsById 上，产生幽灵段
    useHistoryStore.getState().clear()
    set({
      ...INITIAL_DATA,
      projectPath: bundle.path,
      project: bundle.project,
      order: bundle.segments.order,
      segmentsById: bundle.segments.segmentsById,
      selectedSegmentId: bundle.workspace.selectedSegmentId,
      lastPreviewedTakeId: bundle.workspace.lastPreviewedTakeId,
      scriptListScrollTop: bundle.workspace.scriptListScrollTop ?? 0,
      timelineScrollLeft: bundle.workspace.timelineScrollLeft ?? 0,
      timelineZoom: bundle.workspace.timelineZoom ?? 1,
      timelinePlayheadMs: bundle.workspace.timelinePlayheadMs ?? 0
    })
    // 后台扫一次缺失文件，不阻塞 UI。结果回填 missingTakeIds 让 Inspector 标徽
    void window.api.audioAudit.scan().then((result) => {
      // 期间用户可能已经关掉 / 切到别的工程；只在仍是同一工程时回填
      const cur = get()
      if (cur.projectPath !== bundle.path) return
      cur.setMissingTakeIds(result.missing.map((m) => m.takeId))
    })
  },

  clear: () => {
    // 切换工程时若 segments 还有 pending 保存，直接丢弃定时器——
    // 此时前一份工程的锁即将释放，保存已经来不及了（close 已经 flush 过 workspace）。
    cancelPendingSegmentsSave()
    useHistoryStore.getState().clear()
    set({ ...INITIAL_DATA })
  },

  updateProject: (patch) => {
    const prev = get()
    if (!prev.project) return
    // updatedAt 在 renderer 侧写入：保持 store 内存值和磁盘值一致，
    // 避免 main 重新覆写一次时间戳让两边发散。
    const next: Project = {
      ...prev.project,
      ...patch,
      updatedAt: new Date().toISOString()
    }
    set({ project: next })
    // fire-and-forget：失败时通过 toast 提示，但不阻塞 UI 反馈
    void window.api.project.saveProject(next).then((result) => {
      if (!result.ok) {
        showError(
          i18n.t('errors.save_project_title'),
          i18n.t('errors.save_project_description', { message: result.message })
        )
      }
    })
  },

  applyHistoryPatch: (patch) => {
    let dirty = false
    set((state: EditorState) => {
      const delta = patch(state)
      if (!delta) return state
      dirty = true
      return { ...delta, ...markDirty() }
    })
    if (dirty) {
      scheduleSegmentsSave()
      // selectedSegmentId 可能被 revert 改动，同步一份 workspace 到 main
      pushWorkspace(get())
    }
  },

  // -------- audit 回调（不进 undo 栈） --------

  setMissingTakeIds: (takeIds) => set({ missingTakeIds: new Set(takeIds) }),

  applyRemapResult: (segmentId, takeId, durationMs) => {
    set((state: EditorState) => {
      const seg = state.segmentsById[segmentId]
      if (!seg) return state
      const idx = seg.takes.findIndex((t) => t.id === takeId)
      if (idx < 0) return state
      const nextTakes = seg.takes.slice()
      nextTakes[idx] = { ...nextTakes[idx], durationMs }
      // 从 missingTakeIds 移除：复制一份新 Set 以保持引用替换语义
      const nextMissing = new Set(state.missingTakeIds)
      nextMissing.delete(takeId)
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...seg, takes: nextTakes }
        },
        missingTakeIds: nextMissing,
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  },

  appendTakeFromOrphan: (segmentId, take) => {
    set((state: EditorState) => {
      const seg = state.segmentsById[segmentId]
      if (!seg) return state
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...seg, takes: [...seg.takes, take] }
        },
        ...markDirty()
      }
    })
    scheduleSegmentsSave()
  }
})
