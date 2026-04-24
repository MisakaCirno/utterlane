import { create } from 'zustand'
import type { ProjectBundle, WorkspaceFile } from '@shared/project'
import type { PlaybackMode, Project, Segment } from '@renderer/types/project'

/**
 * 编辑器 store 承载「当前打开的工程」的全部内存状态。
 * 工程未打开时 project 为 null，其他字段为空 / 默认，此时 UI 应显示欢迎页。
 *
 * 数据流：
 *   - 打开 / 新建工程：UI 调 window.api.project.{open,new,openPath}，
 *     拿到 ProjectBundle 后调 applyBundle() 灌入 store
 *   - 关闭工程：UI 调 window.api.project.close()，然后 clear()
 *   - 工作区改动（选中 / 滚动 / 缩放）：更新 store 的同时 send 一份 WorkspaceFile 给 main 做 debounce 保存
 *   - Segment / Take 改动将在 Slice C 接入专门的保存通道（segments.json 需立即原子写）
 *
 * 本 store 不保存偏好类数据（主题、列宽、字体缩放等），那些在 preferencesStore。
 */
type EditorState = {
  /** 工程目录的绝对路径；仅在内存和 IPC 中流通，不会写入任何工程文件 */
  projectPath: string | null
  /** 当前打开的工程元信息；null 表示没有活动工程 */
  project: Project | null
  order: string[]
  segmentsById: Record<string, Segment>

  selectedSegmentId: string | undefined
  lastPreviewedTakeId: string | undefined
  scriptListScrollTop: number
  timelineScrollLeft: number
  timelineZoom: number

  playback: PlaybackMode
  saved: boolean

  // 写入操作
  applyBundle: (bundle: ProjectBundle) => void
  clear: () => void

  selectSegment: (id: string | undefined) => void
  setPlayback: (mode: PlaybackMode) => void
  setSelectedTake: (segmentId: string, takeId: string) => void

  setScriptListScrollTop: (top: number) => void
  setTimelineScroll: (left: number, zoom?: number) => void
}

/** 从当前 store 状态抽出要写盘的 WorkspaceFile 子集。*/
function snapshotWorkspace(state: EditorState): WorkspaceFile {
  return {
    schemaVersion: 1,
    selectedSegmentId: state.selectedSegmentId,
    lastPreviewedTakeId: state.lastPreviewedTakeId,
    scriptListScrollTop: state.scriptListScrollTop,
    timelineScrollLeft: state.timelineScrollLeft,
    timelineZoom: state.timelineZoom
  }
}

/**
 * 把 workspace 的当前快照推给 main。放在这里而不是每个 setter 里重复写，
 * 保证 main 拿到的永远是完整快照（main 侧做的是替换式保存，不是 patch 合并）。
 */
function pushWorkspace(state: EditorState): void {
  if (!state.projectPath) return
  window.api.project.saveWorkspace(snapshotWorkspace(state))
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectPath: null,
  project: null,
  order: [],
  segmentsById: {},

  selectedSegmentId: undefined,
  lastPreviewedTakeId: undefined,
  scriptListScrollTop: 0,
  timelineScrollLeft: 0,
  timelineZoom: 1,

  playback: 'idle',
  saved: true,

  applyBundle: (bundle) =>
    set({
      projectPath: bundle.path,
      project: bundle.project,
      order: bundle.segments.order,
      segmentsById: bundle.segments.segmentsById,
      selectedSegmentId: bundle.workspace.selectedSegmentId,
      lastPreviewedTakeId: bundle.workspace.lastPreviewedTakeId,
      scriptListScrollTop: bundle.workspace.scriptListScrollTop ?? 0,
      timelineScrollLeft: bundle.workspace.timelineScrollLeft ?? 0,
      timelineZoom: bundle.workspace.timelineZoom ?? 1,
      playback: 'idle',
      saved: true
    }),

  clear: () =>
    set({
      projectPath: null,
      project: null,
      order: [],
      segmentsById: {},
      selectedSegmentId: undefined,
      lastPreviewedTakeId: undefined,
      scriptListScrollTop: 0,
      timelineScrollLeft: 0,
      timelineZoom: 1,
      playback: 'idle',
      saved: true
    }),

  selectSegment: (id) => {
    set({ selectedSegmentId: id })
    pushWorkspace(get())
  },
  setPlayback: (mode) => set({ playback: mode }),
  setSelectedTake: (segmentId, takeId) => {
    set((state) => {
      const segment = state.segmentsById[segmentId]
      if (!segment) return state
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...segment, selectedTakeId: takeId }
        }
      }
    })
    // selectedTakeId 属于 segments.json，本 patch 也应落盘——Slice C 再接入。
    // 这里只更新内存，UI 反应仍然实时。
  },

  setScriptListScrollTop: (top) => {
    set({ scriptListScrollTop: top })
    pushWorkspace(get())
  },
  setTimelineScroll: (left, zoom) => {
    set({ timelineScrollLeft: left, ...(zoom !== undefined && { timelineZoom: zoom }) })
    pushWorkspace(get())
  }
}))
