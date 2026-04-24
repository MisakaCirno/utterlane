import {
  ChevronLeft,
  ChevronRight,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Rewind,
  SkipBack,
  SkipForward,
  Square
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useRef } from 'react'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { formatDuration } from '@renderer/lib/format'

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

function RowLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="absolute left-2 text-2xs uppercase tracking-wider text-fg-dim">
      {children}
    </span>
  )
}

function ControlBar(): React.JSX.Element {
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const playback = useEditorStore((s) => s.playback)
  const recordingSegmentId = useEditorStore((s) => s.recordingSegmentId)
  const startRecording = useEditorStore((s) => s.startRecordingForSelected)
  const startRerecording = useEditorStore((s) => s.startRerecordingSelected)
  const stopRecording = useEditorStore((s) => s.stopRecordingAndSave)
  const playCurrentSegment = useEditorStore((s) => s.playCurrentSegment)
  const playProject = useEditorStore((s) => s.playProject)
  const stopPlayback = useEditorStore((s) => s.stopPlayback)
  const togglePause = useEditorStore((s) => s.togglePausePlayback)
  const paused = useEditorStore((s) => s.paused)
  const selectSegment = useEditorStore((s) => s.selectSegment)
  const order = useEditorStore((s) => s.order)
  const takeCount = segment?.takes.length ?? 0

  const isRecordingThis = playback === 'recording' && recordingSegmentId === selectedId
  const isRecordingOther = playback === 'recording' && !isRecordingThis
  const isBusy = playback !== 'idle'

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

  /**
   * Take 切换：在当前 Segment 的 takes 数组里上下移动 selectedTakeId。
   * 没有 currentTake 时从头开始。
   */
  const setSelectedTake = useEditorStore((s) => s.setSelectedTake)
  const stepTake = (delta: -1 | 1): void => {
    if (!segment || !selectedId) return
    const idx = segment.takes.findIndex((t) => t.id === segment.selectedTakeId)
    const next = Math.max(0, Math.min(segment.takes.length - 1, (idx < 0 ? 0 : idx) + delta))
    if (next !== idx && segment.takes[next]) {
      setSelectedTake(selectedId, segment.takes[next].id)
    }
  }

  return (
    <div className="shrink-0 border-b border-border bg-bg-panel">
      <div className="relative flex h-8 items-center justify-center border-b border-border-subtle px-2">
        <RowLabel>Segment</RowLabel>
        <div className="flex items-center gap-0.5 rounded-sm border border-border bg-bg-deep p-0.5">
          <IconButton
            title="上一句"
            onClick={onPrevSegment}
            disabled={isBusy || !selectedId || order.indexOf(selectedId) <= 0}
          >
            <ChevronLeft size={13} />
          </IconButton>
          <IconButton
            title="下一句"
            onClick={onNextSegment}
            disabled={isBusy || !selectedId || order.indexOf(selectedId) >= order.length - 1}
          >
            <ChevronRight size={13} />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            title="上一个 Take"
            onClick={() => stepTake(-1)}
            disabled={isBusy || takeCount < 2}
          >
            <SkipBack size={12} />
          </IconButton>
          <IconButton
            title="下一个 Take"
            onClick={() => stepTake(1)}
            disabled={isBusy || takeCount < 2}
          >
            <SkipForward size={12} />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            title={playback === 'segment' ? '停止' : '播放当前句'}
            active={playback === 'segment'}
            disabled={
              playback === 'project' || playback === 'recording' || !segment?.selectedTakeId
            }
            onClick={playback === 'segment' ? stopPlayback : () => void playCurrentSegment()}
          >
            {playback === 'segment' ? <Square size={11} /> : <Play size={12} />}
          </IconButton>
          <IconButton
            title={paused ? '继续' : '暂停'}
            active={paused}
            onClick={togglePause}
            disabled={playback !== 'segment' && playback !== 'project'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </IconButton>
          <IconButton
            title="停止"
            onClick={stopPlayback}
            disabled={playback === 'idle' || playback === 'recording'}
          >
            <Square size={11} />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            title={isRecordingThis ? '停止录音' : '录音'}
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
            title="重录（覆盖当前 Take）"
            disabled={isBusy || !segment?.selectedTakeId}
            onClick={() => void startRerecording()}
          >
            <RotateCcw size={12} />
          </IconButton>
        </div>
      </div>

      <div className="relative flex h-8 items-center justify-center px-2">
        <RowLabel>Project</RowLabel>
        <div className="flex items-center gap-0.5 rounded-sm border border-border bg-bg-deep p-0.5">
          <IconButton
            title="从头播放项目"
            onClick={() => {
              if (order.length > 0) selectSegment(order[0])
              void playProject()
            }}
            disabled={isBusy || order.length === 0}
          >
            <Rewind size={12} />
          </IconButton>
          <IconButton
            title={playback === 'project' ? '停止' : '播放项目'}
            active={playback === 'project'}
            disabled={playback === 'segment' || playback === 'recording' || order.length === 0}
            onClick={playback === 'project' ? stopPlayback : () => void playProject()}
          >
            {playback === 'project' ? <Square size={11} /> : <Play size={12} />}
          </IconButton>
          <IconButton
            title={paused ? '继续项目' : '暂停项目'}
            active={paused}
            onClick={togglePause}
            disabled={playback !== 'project'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </IconButton>
          <IconButton title="停止项目" onClick={stopPlayback} disabled={playback !== 'project'}>
            <Square size={11} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

const PX_PER_MS = 0.08
const UNRECORDED_CLIP_WIDTH = 60

/**
 * 单个 Timeline clip。整块 clip 是 drag handle（DAW / 视频剪辑里这是惯例）。
 * 用 PointerSensor.distance 防止单击选中被误判为拖拽。
 */
function TimelineClip({
  id,
  idx,
  startMs
}: {
  id: string
  idx: number
  startMs: number
}): React.JSX.Element | null {
  const seg = useEditorStore((s) => s.segmentsById[id])
  const isSelected = useEditorStore((s) => s.selectedSegmentId === id)
  const selectSegment = useEditorStore((s) => s.selectSegment)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  })

  // 合并 dnd-kit ref 与自己的 ref：后者用于选中时横向滚到可见位置
  const clipElementRef = useRef<HTMLDivElement | null>(null)
  const combinedRef = (el: HTMLDivElement | null): void => {
    clipElementRef.current = el
    setNodeRef(el)
  }

  useEffect(() => {
    if (isSelected && clipElementRef.current) {
      // inline: 'nearest' 保证元素已经可见时不滚；timeline 是横向滚动，block 不重要
      clipElementRef.current.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [isSelected])

  if (!seg) return null
  const current = seg.takes.find((t) => t.id === seg.selectedTakeId)
  const hasAudio = !!current
  const width = hasAudio ? current.durationMs * PX_PER_MS : UNRECORDED_CLIP_WIDTH

  const style: React.CSSProperties = {
    width,
    minWidth: UNRECORDED_CLIP_WIDTH,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined
  }

  return (
    <div
      ref={combinedRef}
      {...attributes}
      {...listeners}
      onClick={() => selectSegment(id)}
      title={seg.text}
      className={cn(
        'relative flex shrink-0 cursor-pointer flex-col justify-between rounded-sm border px-1.5 py-1 text-[10px]',
        hasAudio
          ? isSelected
            ? 'border-accent bg-accent-soft text-white'
            : 'border-border bg-bg-raised text-fg hover:border-border-strong'
          : isSelected
            ? 'border-accent bg-bg-deep text-fg-muted'
            : 'border-dashed border-border bg-bg-deep text-fg-dim hover:border-border-strong',
        isDragging && 'shadow-lg ring-1 ring-accent'
      )}
      style={style}
    >
      <div className="flex items-center gap-1">
        <span className="font-mono tabular-nums opacity-70">{idx + 1}</span>
        <span className="truncate">{seg.text}</span>
      </div>
      <div className="flex items-center justify-between font-mono tabular-nums opacity-70">
        <span>{formatDuration(startMs)}</span>
        {hasAudio ? <span>{formatDuration(current.durationMs)}</span> : <span>未录制</span>}
      </div>
    </div>
  )
}

function TimelineContent(): React.JSX.Element {
  const order = useEditorStore((s) => s.order)
  const segmentsById = useEditorStore((s) => s.segmentsById)
  const reorderSegments = useEditorStore((s) => s.reorderSegments)

  // 每个 clip 的起点时间戳，基于前序 clip 累积时长。先算好避免在 map 里 mutate。
  const startMsById = new Map<string, number>()
  {
    let acc = 0
    for (const id of order) {
      startMsById.set(id, acc)
      const seg = segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      acc += take?.durationMs ?? 0
    }
  }

  // 同 SegmentsView：4px 激活阈值防止单击选中被当成拖拽
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    reorderSegments(arrayMove(order, from, to))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="relative h-6 shrink-0 overflow-hidden border-b border-border bg-bg-deep">
        <div className="absolute inset-0 flex">
          {Array.from({ length: 30 }, (_, i) => (
            <div
              key={i}
              className="flex shrink-0 items-end border-r border-border-subtle pb-0.5 pl-1 font-mono text-[9px] text-fg-dim"
              style={{ width: 120 }}
            >
              {String(Math.floor(i / 60)).padStart(2, '0')}:{String(i % 60).padStart(2, '0')}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="relative h-24 min-w-max p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={order} strategy={horizontalListSortingStrategy}>
              <div className="flex h-full items-stretch gap-0.5">
                {order.map((id, idx) => (
                  <TimelineClip key={id} id={id} idx={idx} startMs={startMsById.get(id) ?? 0} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  )
}

export function TimelineView(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col bg-bg">
      <ControlBar />
      <TimelineContent />
    </div>
  )
}
