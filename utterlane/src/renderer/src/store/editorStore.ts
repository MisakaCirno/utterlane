import { create } from 'zustand'
import type { PlaybackMode, Project, Segment } from '@renderer/types/project'
import { mockOrder, mockProject, mockSegments } from '@renderer/mock/fixtures'
import type { ThemeKey } from '@renderer/shell/themes'

type EditorState = {
  project: Project
  order: string[]
  segmentsById: Record<string, Segment>
  selectedSegmentId: string | undefined
  playback: PlaybackMode
  saved: boolean
  dockTheme: ThemeKey

  selectSegment: (id: string) => void
  setPlayback: (mode: PlaybackMode) => void
  setSelectedTake: (segmentId: string, takeId: string) => void
  setDockTheme: (theme: ThemeKey) => void
}

const initialSegments: Record<string, Segment> = Object.fromEntries(
  mockSegments.map((s) => [s.id, s])
)

export const useEditorStore = create<EditorState>((set) => ({
  project: mockProject,
  order: mockOrder,
  segmentsById: initialSegments,
  selectedSegmentId: mockOrder[4],
  playback: 'idle',
  saved: true,
  dockTheme: 'dark',

  selectSegment: (id) => set({ selectedSegmentId: id }),
  setPlayback: (mode) => set({ playback: mode }),
  setDockTheme: (theme) => set({ dockTheme: theme }),
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
    })
}))
