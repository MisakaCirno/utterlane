import { create } from 'zustand'
import type { PlaybackMode, Project, Segment } from '@renderer/types/project'
import { mockOrder, mockProject, mockSegments } from '@renderer/mock/fixtures'

/**
 * 编辑器 store 承载「当前打开的工程」的全部内存状态。
 * 工程未打开时 project 为 null，其他字段为空/默认，此时 UI 应显示欢迎页。
 *
 * 这里不存偏好类数据（主题、列宽、字体缩放等），那些在 preferencesStore。
 * 本 store 对应的持久化目标是 segments.json / workspace.json，
 * 随工程切换整体替换。
 */
type EditorState = {
  /** 当前打开的工程元信息；null 表示没有活动工程 */
  project: Project | null
  order: string[]
  segmentsById: Record<string, Segment>
  selectedSegmentId: string | undefined
  playback: PlaybackMode
  saved: boolean

  selectSegment: (id: string) => void
  setPlayback: (mode: PlaybackMode) => void
  setSelectedTake: (segmentId: string, takeId: string) => void

  /**
   * 打开工程。目前是 stub——把 mock 数据灌进 store 以便开发联调。
   * Slice B 会把实现换成真正从文件系统加载 project.json + segments.json。
   */
  openMockProject: () => void
  closeProject: () => void
}

function buildSegmentsIndex(segments: Segment[]): Record<string, Segment> {
  return Object.fromEntries(segments.map((s) => [s.id, s]))
}

export const useEditorStore = create<EditorState>((set) => ({
  project: null,
  order: [],
  segmentsById: {},
  selectedSegmentId: undefined,
  playback: 'idle',
  saved: true,

  selectSegment: (id) => set({ selectedSegmentId: id }),
  setPlayback: (mode) => set({ playback: mode }),
  setSelectedTake: (segmentId, takeId) =>
    set((state) => {
      const segment = state.segmentsById[segmentId]
      if (!segment) return state
      return {
        segmentsById: {
          ...state.segmentsById,
          [segmentId]: { ...segment, selectedTakeId: takeId }
        }
      }
    }),

  openMockProject: () =>
    set({
      project: mockProject,
      order: mockOrder,
      segmentsById: buildSegmentsIndex(mockSegments),
      // 默认选中一个有多 Take 的段，方便在 Inspector 里直接看到切换效果
      selectedSegmentId: mockOrder[4],
      playback: 'idle',
      saved: true
    }),

  closeProject: () =>
    set({
      project: null,
      order: [],
      segmentsById: {},
      selectedSegmentId: undefined,
      playback: 'idle',
      saved: true
    })
}))
