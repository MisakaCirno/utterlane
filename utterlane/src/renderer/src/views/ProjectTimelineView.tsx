import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import * as ContextMenu from '@radix-ui/react-context-menu'
import {
  ArrowDownFromLine,
  ArrowUpFromLine,
  Eraser,
  Pause,
  Play,
  RefreshCw,
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
 * 内置默认间隔：句间 200ms / 段间 800ms。当 project.defaultGaps 未配置 /
 * 字段缺失时回退到这两个值
 */
const FALLBACK_SENTENCE_GAP_MS = 200
const FALLBACK_PARAGRAPH_GAP_MS = 800

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
  const resetGapsToDefault = useEditorStore((s) => s.resetGapsToDefault)
  const clearAutoGaps = useEditorStore((s) => s.clearAutoGaps)
  // 默认间隔从 project.defaultGaps 读，缺失字段回退到内置默认
  const projectDefaultGaps = useEditorStore((s) => s.project?.defaultGaps)

  const isBusy = playback !== 'idle'
  const canEditGaps = !isBusy && order.length > 1
  const defaults = {
    sentenceMs: projectDefaultGaps?.sentenceMs ?? FALLBACK_SENTENCE_GAP_MS,
    paragraphMs: projectDefaultGaps?.paragraphMs ?? FALLBACK_PARAGRAPH_GAP_MS
  }

  // 三段式 grid 布局：左 = 间隔操作；中 = 播放控制；右 = 缩放。
  // 用 grid 而不是 flex+ml-auto 是为了让中间组「真正居中」——
  // ml-auto 的居中受左右两侧宽度差影响，会偏移
  return (
    <div
      className="grid h-8 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-panel px-2"
      style={{ gridTemplateColumns: '1fr auto 1fr' }}
    >
      {/* 左：间隔操作组 */}
      <div className="flex items-center gap-1">
        <IconButton
          title={t('timeline.tb_apply_default_gaps_hint', {
            sentence: defaults.sentenceMs,
            paragraph: defaults.paragraphMs
          })}
          onClick={() => applyDefaultGaps(defaults)}
          disabled={!canEditGaps}
        >
          <AlignVerticalJustifyCenter size={12} />
        </IconButton>
        {/* 重置：覆盖 manual，强制全部回到默认值 */}
        <IconButton
          title={t('timeline.tb_reset_gaps_hint')}
          onClick={() => resetGapsToDefault(defaults)}
          disabled={!canEditGaps}
        >
          <RefreshCw size={11} />
        </IconButton>
        {/* 清除：仅清掉非 manual 的，保留用户手动设置过的 */}
        <IconButton
          title={t('timeline.tb_clear_auto_gaps_hint')}
          onClick={() => clearAutoGaps()}
          disabled={!canEditGaps}
        >
          <Eraser size={11} />
        </IconButton>
      </div>

      {/* 中：播放控制组（始终居中，不被左右组宽度推动） */}
      <div className="flex items-center gap-0.5 justify-self-center rounded-sm border border-border bg-bg-deep p-0.5">
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

      {/* 右：缩放控制组 */}
      <div className="flex items-center gap-0.5 justify-self-end rounded-sm border border-border bg-bg-deep p-0.5">
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
  pxPerMs,
  prevSegId,
  hasFollowingClip
}: {
  id: string
  idx: number
  startMs: number
  pxPerMs: number
  /** 上一段 id；首段（idx === 0）传 undefined 表示没有「之前的间隔」可拖 */
  prevSegId: string | undefined
  /** 是否有下一段。最后一段没有「之后的间隔」概念，不渲染右边缘的拖把 */
  hasFollowingClip: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const seg = useEditorStore((s) => s.segmentsById[id])
  const isSelected = useEditorStore((s) => s.selectedSegmentId === id)
  const selectSegment = useEditorStore((s) => s.selectSegment)
  const insertSegmentBefore = useEditorStore((s) => s.insertSegmentBefore)
  const insertSegmentAfter = useEditorStore((s) => s.insertSegmentAfter)
  const setSegmentGap = useEditorStore((s) => s.setSegmentGap)
  // 自身的 gapAfter（右边缘拖把改这个）和上一段的 gapAfter（左边缘拖把改这个）
  const ownGapMs = useEditorStore((s) => s.segmentsById[id]?.gapAfter?.ms ?? 0)
  const prevGapMs = useEditorStore((s) =>
    prevSegId ? (s.segmentsById[prevSegId]?.gapAfter?.ms ?? 0) : 0
  )

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  })

  /**
   * 拖把状态用单个 useRef 跟踪——必须跨 re-render 保留。setSegmentGap 触发
   * 重渲染会让函数闭包重生成；如果 dragRef 在闭包里就丢了。useRef 的对象
   * 引用稳定，pointermove / up 都能拿到 pointerdown 写入的值
   *
   * 同时只能有一个边缘在拖（鼠标只能拖一个），所以 targetSegId 也存进 ref，
   * 由 pointermove 从 ref 里读，不需要左右两边维护两份
   */
  const gapDragRef = useRef<{
    targetSegId: string
    startX: number
    startMs: number
  } | null>(null)

  function startGapDrag(targetSegId: string, currentMs: number, e: React.PointerEvent): void {
    e.preventDefault()
    e.stopPropagation() // 阻止 dnd-kit PointerSensor 接管
    gapDragRef.current = { targetSegId, startX: e.clientX, startMs: currentMs }
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  function onGapDragMove(e: React.PointerEvent): void {
    const ctx = gapDragRef.current
    if (!ctx) return
    const dx = e.clientX - ctx.startX
    const newMs = Math.max(0, Math.round(ctx.startMs + dx / pxPerMs))
    setSegmentGap(ctx.targetSegId, { ms: newMs, manual: true })
  }
  function onGapDragEnd(e: React.PointerEvent): void {
    if (!gapDragRef.current) return
    gapDragRef.current = null
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
  }

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
  // 已录段：宽度严格等于 take 时长 × pxPerMs，外框和时间轴严格对齐
  // 未录段：没有真实时长，给一个 placeholder 宽度让用户能选中（这部分会
  // 让后续 clip 的视觉位置和时间轴产生一点偏差，但未录段本来就不计入播放
  // 时间，可以接受）
  const placeholderWidth = Math.max(
    40,
    UNRECORDED_CLIP_WIDTH_AT_1X * Math.min(1, pxPerMs / BASE_PX_PER_MS)
  )
  const width = hasAudio ? current.durationMs * pxPerMs : placeholderWidth

  const style: React.CSSProperties = {
    width,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined
  }

  // 右边缘拖把宽度。pxPerMs 极小时 clip 自己都很窄，缩小拖把保证它不会
  // 占据 clip 主体的过大比例
  const HANDLE_WIDTH = Math.min(6, Math.max(3, width * 0.15))

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          ref={combinedRef}
          {...attributes}
          {...listeners}
          onClick={() => selectSegment(id)}
          // 右键先选中再弹菜单：用户点哪一段就操作哪一段，不需要先单击再右键
          onContextMenu={() => selectSegment(id)}
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

          {/*
            左 / 右边缘 resize 拖把。绝对定位 + 高 z-index 确保覆盖在 clip
            主体之上，pointer 事件先到拖把这一层。pointer-events-auto 反向
            打开（父级如果 pointer-events:none 不会传染过来）。
            只在「有目标段」时渲染：首段没左侧、末段没右侧
          */}
          {prevSegId && (
            <div
              onPointerDown={(e) => startGapDrag(prevSegId, prevGapMs, e)}
              onPointerMove={onGapDragMove}
              onPointerUp={onGapDragEnd}
              onPointerCancel={onGapDragEnd}
              style={{ width: HANDLE_WIDTH }}
              className={cn(
                'absolute left-0 top-0 bottom-0 z-20 cursor-ew-resize',
                'bg-transparent hover:bg-accent/30'
              )}
              title={t('timeline.handle_resize_gap_hint')}
            />
          )}
          {hasFollowingClip && (
            <div
              onPointerDown={(e) => startGapDrag(id, ownGapMs, e)}
              onPointerMove={onGapDragMove}
              onPointerUp={onGapDragEnd}
              onPointerCancel={onGapDragEnd}
              style={{ width: HANDLE_WIDTH }}
              className={cn(
                'absolute right-0 top-0 bottom-0 z-20 cursor-ew-resize',
                'bg-transparent hover:bg-accent/30'
              )}
              title={t('timeline.handle_resize_gap_hint')}
            />
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={cn(
            'min-w-[180px] rounded-sm border border-border bg-bg-panel py-1 shadow-xl',
            'text-xs text-fg'
          )}
        >
          <ContextMenu.Item
            onSelect={() => insertSegmentBefore(id)}
            className={cn(
              'flex cursor-default items-center gap-2 px-3 py-1.5 outline-none',
              'data-[highlighted]:bg-accent data-[highlighted]:text-white'
            )}
          >
            <ArrowUpFromLine size={11} />
            {t('timeline.ctx_insert_before')}
          </ContextMenu.Item>
          <ContextMenu.Item
            onSelect={() => insertSegmentAfter(id)}
            className={cn(
              'flex cursor-default items-center gap-2 px-3 py-1.5 outline-none',
              'data-[highlighted]:bg-accent data-[highlighted]:text-white'
            )}
          >
            <ArrowDownFromLine size={11} />
            {t('timeline.ctx_insert_after')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/**
 * 段间空白填充：纯视觉。宽度 = gapAfter.ms × pxPerMs，正好填到下一段
 * 左边缘。不响应拖拽——拖拽逻辑搬到了 TimelineClip 的左 / 右边缘 handle，
 * 让 clip 外框严格对齐时间轴。
 *
 * ms === 0 时不渲染（width 为 0 没意义还会让 flex 多算一格）。manual 与
 * 自动用色调区分：手动 = accent 微黄底，自动 = 中性灰
 */
function GapFiller({
  ms,
  manual,
  pxPerMs
}: {
  ms: number
  manual: boolean
  pxPerMs: number
}): React.JSX.Element | null {
  if (ms <= 0) return null
  const width = ms * pxPerMs
  return (
    <div
      style={{ width }}
      title={`${ms} ms${manual ? ' (manual)' : ''}`}
      className={cn(
        'pointer-events-none relative flex shrink-0 items-center justify-center',
        manual ? 'bg-accent/15' : 'bg-fg-dim/10'
      )}
    >
      <div className="h-full w-px bg-border-strong/50" />
      {ms >= 200 && width > 36 && (
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
                {order.map((id, idx) => {
                  const seg = segmentsById[id]
                  const gap = seg?.gapAfter
                  const isLast = idx === order.length - 1
                  return (
                    <Fragment key={id}>
                      <TimelineClip
                        id={id}
                        idx={idx}
                        startMs={startMsById.get(id) ?? 0}
                        pxPerMs={pxPerMs}
                        prevSegId={idx > 0 ? order[idx - 1] : undefined}
                        hasFollowingClip={!isLast}
                      />
                      {/* 最后一段后面没有间隔；中间段渲染 ms × pxPerMs 宽度的填充 */}
                      {!isLast && (
                        <GapFiller ms={gap?.ms ?? 0} manual={!!gap?.manual} pxPerMs={pxPerMs} />
                      )}
                    </Fragment>
                  )
                })}
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
