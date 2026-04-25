import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Pause,
  Play,
  Rewind,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
  AlignVerticalJustifyCenter
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
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { formatDuration } from '@renderer/lib/format'

/**
 * ProjectTimelineView — 整个项目的横向时间轴。
 *
 * 内容：
 *   1. 项目播放控制条（从头播放 / 播放项目 / 暂停 / 停止）
 *   2. 时间刻度 + 所有 Segment clip 的横向列表（可拖拽重排）
 *
 * 这个面板提供项目级全景：看到所有段的顺序、时长分布、哪些段还没录。
 * 和 SegmentTimelineView 互补——前者 zoom in 到一句，后者 zoom out 看全局。
 */

/**
 * 1x 缩放下每毫秒的像素数。timelineZoom = 1 时 1 秒占 80px，约 12.5 秒充满
 * 1000px 宽容器；适合常规播客 / 课程长度。可配合 zoom 因子放大缩小
 */
const BASE_PX_PER_MS = 0.08
/** 时间轴缩放档位上下限 */
const ZOOM_MIN = 0.1
const ZOOM_MAX = 16
const UNRECORDED_CLIP_WIDTH_AT_1X = 60

/**
 * 默认间隔：句间 200ms / 段间 800ms。这两个值决定 applyDefaultGaps 的填充
 * 量。后续若需要项目级配置，把这两个常量挪进 preferences 即可
 */
const DEFAULT_SENTENCE_GAP_MS = 200
const DEFAULT_PARAGRAPH_GAP_MS = 800

function IconButton({
  children,
  onClick,
  active,
  disabled,
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
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
        active && 'bg-accent text-white'
      )}
    >
      {children}
    </button>
  )
}

function ProjectControlRow({
  zoom,
  onZoomChange
}: {
  zoom: number
  onZoomChange: (next: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const playback = useEditorStore((s) => s.playback)
  const paused = useEditorStore((s) => s.paused)
  const playProject = useEditorStore((s) => s.playProject)
  const stopPlayback = useEditorStore((s) => s.stopPlayback)
  const togglePause = useEditorStore((s) => s.togglePausePlayback)
  const selectSegment = useEditorStore((s) => s.selectSegment)
  const order = useEditorStore((s) => s.order)
  const applyDefaultGaps = useEditorStore((s) => s.applyDefaultGaps)

  const isBusy = playback !== 'idle'

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-2">
      {/* 应用默认间隔：句间 200ms / 段间 800ms，跳过 manual 的段 */}
      <button
        onClick={() =>
          applyDefaultGaps({
            sentenceMs: DEFAULT_SENTENCE_GAP_MS,
            paragraphMs: DEFAULT_PARAGRAPH_GAP_MS
          })
        }
        disabled={isBusy || order.length <= 1}
        title={t('timeline.tb_apply_default_gaps_hint', {
          sentence: DEFAULT_SENTENCE_GAP_MS,
          paragraph: DEFAULT_PARAGRAPH_GAP_MS
        })}
        className={cn(
          'flex h-6 items-center gap-1 rounded-sm border border-border bg-bg-raised px-2 text-2xs',
          'text-fg hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40'
        )}
      >
        <AlignVerticalJustifyCenter size={11} />
        {t('timeline.tb_apply_default_gaps')}
      </button>

      <div className="ml-auto flex items-center gap-0.5 rounded-sm border border-border bg-bg-deep p-0.5">
        <IconButton
          title={t('timeline.btn_play_project_from_start')}
          onClick={() => {
            if (order.length > 0) selectSegment(order[0])
            void playProject()
          }}
          disabled={isBusy || order.length === 0}
        >
          <Rewind size={12} />
        </IconButton>
        <IconButton
          title={
            playback === 'project' ? t('timeline.btn_stop_project') : t('timeline.btn_play_project')
          }
          active={playback === 'project'}
          disabled={playback === 'segment' || playback === 'recording' || order.length === 0}
          onClick={playback === 'project' ? stopPlayback : () => void playProject()}
        >
          {playback === 'project' ? <Square size={11} /> : <Play size={12} />}
        </IconButton>
        <IconButton
          title={paused ? t('timeline.btn_resume_project') : t('timeline.btn_pause_project')}
          active={paused}
          onClick={togglePause}
          disabled={playback !== 'project'}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </IconButton>
        <IconButton
          title={t('timeline.btn_stop_project')}
          onClick={stopPlayback}
          disabled={playback !== 'project'}
        >
          <Square size={11} />
        </IconButton>
      </div>

      {/* zoom 控制：连续缩放，每次按钮 ×/÷ 1.5 倍。Ctrl+滚轮在 TimelineContent
          层处理（更接近鼠标位置） */}
      <div className="flex items-center gap-0.5 rounded-sm border border-border bg-bg-deep p-0.5">
        <IconButton
          title={t('timeline.zoom_out')}
          onClick={() => onZoomChange(clampZoom(zoom / 1.5))}
          disabled={zoom <= ZOOM_MIN}
        >
          <ZoomOut size={12} />
        </IconButton>
        <IconButton
          title={t('timeline.zoom_reset')}
          onClick={() => onZoomChange(1)}
          disabled={zoom === 1}
        >
          <Maximize2 size={11} />
        </IconButton>
        <IconButton
          title={t('timeline.zoom_in')}
          onClick={() => onZoomChange(clampZoom(zoom * 1.5))}
          disabled={zoom >= ZOOM_MAX}
        >
          <ZoomIn size={12} />
        </IconButton>
        <span className="px-1 font-mono text-2xs tabular-nums text-fg-dim">
          {zoom >= 1 ? zoom.toFixed(1) : zoom.toFixed(2)}x
        </span>
      </div>
    </div>
  )
}

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}

/**
 * 单个 Timeline clip。整块 clip 是 drag handle（DAW / 视频剪辑里这是惯例）。
 * 用 PointerSensor.distance 防止单击选中被误判为拖拽。
 */
function TimelineClip({
  id,
  idx,
  startMs,
  pxPerMs
}: {
  id: string
  idx: number
  startMs: number
  pxPerMs: number
}): React.JSX.Element | null {
  const { t } = useTranslation()
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
      clipElementRef.current.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    }
  }, [isSelected])

  if (!seg) return null
  const current = seg.takes.find((t) => t.id === seg.selectedTakeId)
  const hasAudio = !!current
  // 未录段最小宽度也跟着 zoom 走，避免缩到极小时 clip 重叠成一团
  const minWidth = Math.max(40, UNRECORDED_CLIP_WIDTH_AT_1X * Math.min(1, pxPerMs / BASE_PX_PER_MS))
  const width = hasAudio ? current.durationMs * pxPerMs : minWidth

  const style: React.CSSProperties = {
    width,
    minWidth,
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
        {hasAudio ? (
          <span>{formatDuration(current.durationMs)}</span>
        ) : (
          <span>{t('timeline.clip_unrecorded')}</span>
        )}
      </div>
    </div>
  )
}

/**
 * 段间空白「间隔块」：可见区域宽度对应 gapAfter.ms * pxPerMs。
 * 鼠标按住可以左右拖拽调节宽度，松手时设置成 manual: true（applyDefaultGaps
 * 不会再覆盖它）。
 *
 * dnd-kit 的 SortableContext 不接管这个块——它不是 sortable item，纯
 * pointer 事件。pointer-down 时 stopPropagation 防止 dnd-kit 误启动重排
 */
function GapSpacer({ segId, pxPerMs }: { segId: string; pxPerMs: number }): React.JSX.Element {
  const gap = useEditorStore((s) => s.segmentsById[segId]?.gapAfter)
  const setSegmentGap = useEditorStore((s) => s.setSegmentGap)
  const ms = gap?.ms ?? 0
  const isManual = !!gap?.manual

  // 拖拽中的临时本地 ms，避免每次 pointermove 都触发 store 重渲染所有
  // 监听者；pointermove 直接调 setSegmentGap，coalesce 把整段拖拽合成
  // 一格 undo
  const dragRef = useRef<{ startX: number; startMs: number } | null>(null)
  const [hover, setHover] = useState(false)

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startMs: ms }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent): void {
    const ctx = dragRef.current
    if (!ctx) return
    const dx = e.clientX - ctx.startX
    const newMs = Math.max(0, Math.round(ctx.startMs + dx / pxPerMs))
    setSegmentGap(segId, { ms: newMs, manual: true })
  }
  function onPointerUp(e: React.PointerEvent): void {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  // 极窄间隔（< 4px）显示一个最小可见宽度，否则用户找不到拖拽对象。
  // 0ms 时也保留一个 4px hover 触发区，让用户随时可以拖出空白
  const renderedWidth = Math.max(4, ms * pxPerMs)

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={
        ms > 0 ? `${ms} ms${isManual ? ' (manual)' : ''}` : 'Drag to add a gap after this segment'
      }
      style={{ width: renderedWidth }}
      className={cn(
        'relative flex shrink-0 cursor-ew-resize items-center justify-center',
        // 渐变条作为视觉提示：手动设置的用 accent 色调，自动写入的偏中性
        ms > 0
          ? isManual
            ? 'bg-accent/15 hover:bg-accent/30'
            : 'bg-fg-dim/10 hover:bg-fg-dim/25'
          : hover
            ? 'bg-accent/20'
            : 'bg-transparent'
      )}
    >
      {/* 中间细线视觉锚点；ms 较大时显示文本 */}
      <div className="h-full w-px bg-border-strong/50" />
      {ms >= 200 && pxPerMs * ms > 36 && (
        <span className="absolute font-mono text-[9px] tabular-nums text-fg-dim">{ms}</span>
      )}
    </div>
  )
}

function TimelineContent({ pxPerMs }: { pxPerMs: number }): React.JSX.Element {
  const order = useEditorStore((s) => s.order)
  const segmentsById = useEditorStore((s) => s.segmentsById)
  const reorderSegments = useEditorStore((s) => s.reorderSegments)

  // 每个 clip 的起点时间戳：累积「前序 clip 的 take 时长 + gapAfter 时长」
  const startMsById = new Map<string, number>()
  {
    let acc = 0
    for (const id of order) {
      startMsById.set(id, acc)
      const seg = segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      acc += take?.durationMs ?? 0
      acc += seg?.gapAfter?.ms ?? 0
    }
  }

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
      <TimeRuler pxPerMs={pxPerMs} />
      <div className="flex-1 overflow-auto">
        <div className="relative h-24 min-w-max p-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={order} strategy={horizontalListSortingStrategy}>
              <div className="flex h-full items-stretch">
                {order.map((id, idx) => (
                  <Fragment key={id}>
                    <TimelineClip
                      id={id}
                      idx={idx}
                      startMs={startMsById.get(id) ?? 0}
                      pxPerMs={pxPerMs}
                    />
                    {/* 最后一段后面没有间隔，因为没有「下一段」可衔接 */}
                    {idx < order.length - 1 && <GapSpacer segId={id} pxPerMs={pxPerMs} />}
                  </Fragment>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
    </div>
  )
}

/**
 * 时间标尺。tick 间距按当前 pxPerMs 自适应：
 *   - 主 tick 间距尽量保持在 80~160 px 之间
 *   - 候选间距集（ms）：100 / 250 / 500 / 1000 / 2000 / 5000 / 10000 / 30000 / 60000
 *   - 在候选集合里挑「让 px 落到 80~160」的最小间距
 */
function TimeRuler({ pxPerMs }: { pxPerMs: number }): React.JSX.Element {
  const tickIntervalMs = pickTickInterval(pxPerMs)
  const tickPx = tickIntervalMs * pxPerMs

  // 容器宽度无法静态拿到——画一段足够宽的 ruler（比如 3000 个 tick）就能
  // 覆盖几乎任何项目长度。多余 tick 横向 overflow 隐藏，不影响滚动
  const ticks = 3000

  return (
    <div className="relative h-6 shrink-0 overflow-hidden border-b border-border bg-bg-deep">
      <div className="absolute inset-0 flex">
        {Array.from({ length: ticks }, (_, i) => (
          <div
            key={i}
            style={{ width: tickPx }}
            className="flex shrink-0 items-end border-r border-border-subtle pb-0.5 pl-1 font-mono text-[9px] text-fg-dim"
          >
            {formatRulerLabel(i * tickIntervalMs)}
          </div>
        ))}
      </div>
    </div>
  )
}

/** ruler 用的 mm:ss 标签，尽量短，不显示毫秒 */
function formatRulerLabel(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const TICK_CANDIDATES_MS = [
  50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000
]

function pickTickInterval(pxPerMs: number): number {
  // 期望主 tick 落在 80~160 px。从最小开始挑第一个 ≥ 80px 的；如果都不够
  // 大就退到最大档位
  for (const ms of TICK_CANDIDATES_MS) {
    if (ms * pxPerMs >= 80) return ms
  }
  return TICK_CANDIDATES_MS[TICK_CANDIDATES_MS.length - 1]
}

export function ProjectTimelineView(): React.JSX.Element {
  // 缩放从 workspace 持久化（已经在 editorStore.timelineZoom 字段里）
  const zoom = useEditorStore((s) => s.timelineZoom)
  const setTimelineScroll = useEditorStore((s) => s.setTimelineScroll)
  const pxPerMs = BASE_PX_PER_MS * zoom

  // Ctrl/Cmd + 滚轮缩放：DAW 习惯。普通滚轮保持横向滚动行为
  // 容器 ref 用来监听 wheel 事件
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      // deltaY > 0 = 向下滚（缩小）；< 0 = 向上滚（放大）
      const factor = Math.exp(-e.deltaY * 0.0015)
      const nextZoom = clampZoom(zoom * factor)
      setTimelineScroll(useEditorStore.getState().timelineScrollLeft, nextZoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, setTimelineScroll])

  return (
    <div ref={wrapperRef} className="flex h-full flex-col bg-bg">
      <ProjectControlRow
        zoom={zoom}
        onZoomChange={(next) =>
          setTimelineScroll(useEditorStore.getState().timelineScrollLeft, next)
        }
      />
      <TimelineContent pxPerMs={pxPerMs} />
    </div>
  )
}
