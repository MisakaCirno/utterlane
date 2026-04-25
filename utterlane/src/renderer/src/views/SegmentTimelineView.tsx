import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  ChevronRight,
  Mic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { WaveformView } from '@renderer/components/WaveformView'
import { DEFAULT_PREFERENCES, type TextAlign } from '@shared/preferences'

function alignClass(align: TextAlign): string {
  return align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'
}

/**
 * SegmentTimelineView — 当前选中 Segment 的「细节 + 时间轴」面板。
 *
 * 内容（从上到下）：
 *   1. Segment 控制条（上下句 / Take 切换 / 播放停止 / 录音重录）
 *   2. 可编辑文案 textarea
 *   3. 当前 Take 的波形
 *
 * 这个面板聚焦「一句话」的维度，和 ProjectTimelineView 的「整个项目」维度
 * 是两个正交的视角。两边都可以独立 dock / 调尺寸 / 显示隐藏。
 *
 * 与 Inspector 的关系：
 *   - Inspector 管元信息（顺序、Take 列表、删除 Segment）
 *   - SegmentTimeline 管「时间维度的内容」（波形 + 播放控制 + 文案）
 *   - 两处都能编辑文案，通过共享 editSegmentText action 天然同步
 */

function IconButton({
  children,
  onClick,
  active,
  danger,
  disabled,
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted',
        'disabled:cursor-not-allowed disabled:opacity-40',
        !disabled && !active && 'hover:bg-chrome-hover hover:text-fg',
        active && !danger && 'bg-accent text-white',
        active && danger && 'bg-rec text-white'
      )}
    >
      {children}
    </button>
  )
}

function SegmentControlRow(): React.JSX.Element {
  const { t } = useTranslation()
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const playback = useEditorStore((s) => s.playback)
  const paused = useEditorStore((s) => s.paused)
  const recordingSegmentId = useEditorStore((s) => s.recordingSegmentId)
  const startRecording = useEditorStore((s) => s.startRecordingForSelected)
  const startRerecording = useEditorStore((s) => s.startRerecordingSelected)
  const stopRecording = useEditorStore((s) => s.stopRecordingAndSave)
  const playCurrentSegment = useEditorStore((s) => s.playCurrentSegment)
  const stopPlayback = useEditorStore((s) => s.stopPlayback)
  const togglePause = useEditorStore((s) => s.togglePausePlayback)
  const selectSegment = useEditorStore((s) => s.selectSegment)
  const setSelectedTake = useEditorStore((s) => s.setSelectedTake)
  const order = useEditorStore((s) => s.order)
  const takeCount = segment?.takes.length ?? 0

  const isRecordingThis = playback === 'recording' && recordingSegmentId === selectedId
  const isRecordingOther = playback === 'recording' && !isRecordingThis

  const onRecordClick = (): void => {
    if (isRecordingThis) void stopRecording()
    else if (playback === 'idle') void startRecording()
  }

  const onPrevSegment = (): void => {
    if (!selectedId) return
    const idx = order.indexOf(selectedId)
    if (idx > 0) selectSegment(order[idx - 1])
  }
  const onNextSegment = (): void => {
    if (!selectedId) return
    const idx = order.indexOf(selectedId)
    if (idx >= 0 && idx < order.length - 1) selectSegment(order[idx + 1])
  }
  const stepTake = (delta: -1 | 1): void => {
    if (!segment || !selectedId) return
    const idx = segment.takes.findIndex((t) => t.id === segment.selectedTakeId)
    const next = Math.max(0, Math.min(segment.takes.length - 1, (idx < 0 ? 0 : idx) + delta))
    if (next !== idx && segment.takes[next]) {
      setSelectedTake(selectedId, segment.takes[next].id)
    }
  }

  return (
    <div className="flex h-8 shrink-0 items-center justify-center border-b border-border-subtle bg-bg-panel px-2">
      <div className="flex items-center gap-0.5 rounded-sm border border-border bg-bg-deep p-0.5">
        <IconButton
          title={t('timeline.btn_prev_segment')}
          onClick={onPrevSegment}
          disabled={playback !== 'idle' || !selectedId || order.indexOf(selectedId) <= 0}
        >
          <ChevronLeft size={13} />
        </IconButton>
        <IconButton
          title={t('timeline.btn_next_segment')}
          onClick={onNextSegment}
          disabled={
            playback !== 'idle' || !selectedId || order.indexOf(selectedId) >= order.length - 1
          }
        >
          <ChevronRight size={13} />
        </IconButton>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          title={t('timeline.btn_prev_take')}
          onClick={() => stepTake(-1)}
          disabled={playback !== 'idle' || takeCount < 2}
        >
          <SkipBack size={12} />
        </IconButton>
        <IconButton
          title={t('timeline.btn_next_take')}
          onClick={() => stepTake(1)}
          disabled={playback !== 'idle' || takeCount < 2}
        >
          <SkipForward size={12} />
        </IconButton>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          title={
            playback === 'segment' ? t('timeline.btn_stop_segment') : t('timeline.btn_play_segment')
          }
          active={playback === 'segment'}
          disabled={playback === 'project' || playback === 'recording' || !segment?.selectedTakeId}
          onClick={playback === 'segment' ? stopPlayback : () => void playCurrentSegment()}
        >
          {playback === 'segment' ? <Square size={11} /> : <Play size={12} />}
        </IconButton>
        <IconButton
          title={paused ? t('timeline.btn_resume') : t('timeline.btn_pause')}
          active={paused}
          onClick={togglePause}
          disabled={playback !== 'segment' && playback !== 'project'}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </IconButton>
        <IconButton
          title={t('timeline.btn_stop_segment')}
          onClick={stopPlayback}
          disabled={playback === 'idle' || playback === 'recording'}
        >
          <Square size={11} />
        </IconButton>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <IconButton
          title={isRecordingThis ? t('timeline.btn_stop_recording') : t('timeline.btn_record')}
          active={isRecordingThis}
          danger
          disabled={
            isRecordingOther || !selectedId || playback === 'segment' || playback === 'project'
          }
          onClick={onRecordClick}
        >
          {isRecordingThis ? <Square size={11} /> : <Mic size={12} />}
        </IconButton>
        <IconButton
          title={t('timeline.btn_rerecord')}
          disabled={playback !== 'idle' || !segment?.selectedTakeId}
          onClick={() => void startRerecording()}
        >
          <RotateCcw size={12} />
        </IconButton>
      </div>
    </div>
  )
}

function SegmentTextEditor(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const text = useEditorStore((s) =>
    s.selectedSegmentId ? (s.segmentsById[s.selectedSegmentId]?.text ?? '') : ''
  )
  const editSegmentText = useEditorStore((s) => s.editSegmentText)
  const align = usePreferencesStore(
    (s) => s.prefs.appearance?.segmentTextAlign ?? DEFAULT_PREFERENCES.appearance!.segmentTextAlign!
  )

  return (
    <div className="shrink-0 border-b border-border-subtle bg-bg px-3 py-2">
      <textarea
        value={text}
        disabled={!selectedId}
        onChange={(e) => selectedId && editSegmentText(selectedId, e.target.value)}
        onBlur={(e) => {
          if (!selectedId) return
          const trimmed = e.target.value.trim()
          if (trimmed !== e.target.value) editSegmentText(selectedId, trimmed)
        }}
        onKeyDown={(e) => {
          // 单行约束：和 Inspector 文案区一致，拦截 Enter 阻止换行
          if (e.key === 'Enter') e.preventDefault()
        }}
        placeholder={t('timeline.segment_text_placeholder')}
        className={cn(
          'w-full resize-none rounded-sm border border-border bg-bg-deep px-2 py-1',
          'text-xs leading-5 outline-none focus:border-accent',
          'disabled:cursor-not-allowed disabled:opacity-60',
          alignClass(align)
        )}
        rows={2}
      />
    </div>
  )
}

export function SegmentTimelineView(): React.JSX.Element {
  // 波形对应当前选中 Segment 的当前 Take 文件路径
  const filePath = useEditorStore((s) => {
    if (!s.selectedSegmentId) return null
    const seg = s.segmentsById[s.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    return take?.filePath ?? null
  })

  return (
    <div className="flex h-full flex-col bg-bg">
      <SegmentControlRow />
      <SegmentTextEditor />
      <WaveformView filePath={filePath} />
    </div>
  )
}
