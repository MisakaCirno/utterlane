import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
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
import { subscribePosition } from '@renderer/services/player'
import { takeEffectiveDurationMs, takeEffectiveRange } from '@shared/project'

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

  // 布局策略：
  //   - 内层 grid 用 `1fr auto 1fr` 让中间播放控制组在面板够宽时真正
  //     居中（不会被左右组宽度差推动）。
  //   - 外层包一层 overflow-x-auto + 内层 min-w-max。当 dockview 把 tab
  //     移到左边、面板可用宽度变窄时，三组按钮的总宽度仍然得到保留，
  //     超出部分横向滚动而不是被裁掉——重点是「所有按钮始终可点」。
  //   - shrink-0 在外层保持工具栏自身高度不被纵向挤压
  return (
    <div className="h-8 shrink-0 overflow-x-auto border-b border-border-subtle bg-bg-panel">
      <div
        className="grid h-full min-w-max items-center gap-2 px-2"
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
              playback === 'project'
                ? t('timeline.btn_stop_project')
                : t('timeline.btn_play_project')
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
  // 已录段：宽度等于「节选后有效时长」× pxPerMs。trim 之后 clip 宽度自然
  // 反映「实际会播 / 导出的那段时间」，与 ProjectTimeline 的累计起点
  // 算法一致。clip 内部展示原 take 时长 / 有效时长两个数字让用户对比。
  // 未录段：没有真实时长，给 placeholder 宽度让用户能选中（这部分会让
  // 后续 clip 的视觉位置和时间轴产生一点偏差，但未录段本来就不计入播放
  // 时间，可以接受）
  const placeholderWidth = Math.max(
    40,
    UNRECORDED_CLIP_WIDTH_AT_1X * Math.min(1, pxPerMs / BASE_PX_PER_MS)
  )
  const effectiveDurationMs = current ? takeEffectiveDurationMs(current) : 0
  const width = hasAudio ? effectiveDurationMs * pxPerMs : placeholderWidth

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
              <span>{formatDuration(effectiveDurationMs)}</span>
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
  const setTimelineScroll = useEditorStore((s) => s.setTimelineScroll)
  const timelineZoom = useEditorStore((s) => s.timelineZoom)
  const playback = useEditorStore((s) => s.playback)
  const storedPlayheadMs = useEditorStore((s) => s.timelinePlayheadMs)
  const setTimelinePlayhead = useEditorStore((s) => s.setTimelinePlayhead)
  const persistedScrollLeft = useEditorStore.getState().timelineScrollLeft

  // 每个 clip 的起点时间戳：累积「前序 clip 的有效时长 + gapAfter 时长」。
  // 用 takeEffectiveDurationMs 让 trim 后的时间轴正确反映「实际会播 / 导
  // 出的那段时间」——clip 宽度 / 游标 / 起播 ms 都按这个口径算。
  //
  // 顺手建 filePath → { segStart, trimStartMs } 的反查表给播放游标用：
  // subscribePosition 给的是文件相对位置（含 trim 起点），需要减掉
  // trimStart 后再加 segStart 才对齐工程时间轴
  const { startMsById, totalMs, startMsByFilePath } = useMemo(() => {
    const idMap = new Map<string, number>()
    const pathMap = new Map<string, { segStart: number; trimStartMs: number }>()
    let acc = 0
    for (const id of order) {
      idMap.set(id, acc)
      const seg = segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      if (take) {
        const range = takeEffectiveRange(take)
        pathMap.set(take.filePath, { segStart: acc, trimStartMs: range.startMs })
        acc += range.endMs - range.startMs
      }
      acc += seg?.gapAfter?.ms ?? 0
    }
    return { startMsById: idMap, totalMs: acc, startMsByFilePath: pathMap }
  }, [order, segmentsById])

  // 播放期间订阅 player 的位置事件，把「文件相对位置」映射成「工程时间轴
  // 全局位置」用于显示游标。空闲时不挂订阅，避免无意义的 RAF 唤醒
  const [livePlayheadMs, setLivePlayheadMs] = useState<number | null>(null)
  useEffect(() => {
    if (playback !== 'project' && playback !== 'segment') {
      setLivePlayheadMs(null)
      return
    }
    return subscribePosition((path, ms) => {
      if (!path) {
        setLivePlayheadMs(null)
        return
      }
      const meta = startMsByFilePath.get(path)
      if (!meta) return
      // ms 是文件相对位置（含 trim 起点），减掉 trimStart 后才是「在
      // effective 段内的偏移」，再加 segStart 才对齐工程时间轴
      setLivePlayheadMs(meta.segStart + Math.max(0, ms - meta.trimStartMs))
    })
  }, [playback, startMsByFilePath])

  // 游标显示的最终 ms：播放中跟随实际进度，空闲时显示存储的 playhead
  const cursorMs =
    livePlayheadMs !== null && (playback === 'project' || playback === 'segment')
      ? livePlayheadMs
      : storedPlayheadMs
  const cursorPx = cursorMs * pxPerMs

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    reorderSegments(arrayMove(order, from, to))
  }

  // ruler 与 content 在同一个水平滚动容器里：原实现 ruler 自带
  // overflow-hidden、和下方独立滚动，标尺永远静止贴左缘，scrollLeft
  // 也从未持久化。统一容器后 ruler 跟随 content 滚动，下面再把当前
  // scrollLeft 推回 store 持久化。
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  // viewport 宽度：用于决定 ruler 实际需要画多少 tick（不再硬编码 3000 个）
  const [viewportWidth, setViewportWidth] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(persistedScrollLeft)

  // 初次挂载时把持久化的 scrollLeft 还原回 DOM；之后由用户滚动驱动。
  // 用 layoutEffect 不必要——一帧延迟内还看不到内容，普通 effect 即可。
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollLeft = persistedScrollLeft
    setScrollLeft(persistedScrollLeft)
    setViewportWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
    // 仅初始化一次：persistedScrollLeft 之后由 store ↔ DOM 双向同步管理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // scroll 事件 → 本地 state（ruler 偏移 / 虚拟化窗口都依赖它）
  // 同时 push 给 store 让 workspace.json 持久化（store 内部不 debounce，
  // main 的 scheduleWorkspaceSave 已经合并连续滚动的写盘）
  const onScroll = (): void => {
    const el = scrollerRef.current
    if (!el) return
    const sl = el.scrollLeft
    setScrollLeft(sl)
    setTimelineScroll(sl, timelineZoom)
  }

  // 内容总宽度：所有 clip 的占位宽度 + 间隔。pxPerMs 用浮点，做一次 ceil
  // 让滚动条容纳尾部那一两个像素的舍入误差
  const contentWidthPx = Math.ceil(totalMs * pxPerMs) + 32 // 32 = 内边距与缓冲

  // 用户点击 ruler → 把游标设到点击位置。仅 idle 时响应：播放期间游标
  // 跟随实际进度，点击设位置语义会和正在播的 take 起冲突；要 seek 先停
  const onRulerClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (playback !== 'idle') return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const ms = Math.max(0, Math.round(clickX / pxPerMs))
    setTimelinePlayhead(ms)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div ref={scrollerRef} onScroll={onScroll} className="flex-1 overflow-auto">
        {/* 整条时间轴的内容容器：ruler / clip 区 / 游标都是它的子元素，
            统一 width 与 relative 上下文。游标 absolute 起来才能正确跨高度 */}
        <div className="relative min-w-max" style={{ width: contentWidthPx }}>
          <TimeRuler
            pxPerMs={pxPerMs}
            scrollLeft={scrollLeft}
            viewportWidth={viewportWidth}
            contentWidthPx={contentWidthPx}
            onClick={onRulerClick}
            clickable={playback === 'idle'}
          />
          <div className="relative h-24 p-2">
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
          {/* 时间游标：单 1px 竖线，pointer-events-none 避免阻断 clip 点击。
              z-index 高于 clip（z-10）但低于 ruler 的 sticky-ish 层级，让标尺
              数字能盖在游标上方仍然可读 */}
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute top-0 bottom-0 z-20 w-px',
              livePlayheadMs !== null ? 'bg-rec' : 'bg-accent'
            )}
            style={{ left: cursorPx }}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * 时间标尺。tick 间距按当前 pxPerMs 自适应：
 *   - 主 tick 间距尽量保持在 80~160 px 之间
 *   - 候选间距集见 TICK_CANDIDATES_MS
 *
 * === 虚拟化 ===
 *
 * 旧实现硬编码 3000 个 tick div 一次性渲染——zoom 变化 / 任何重渲染都是
 * 3000 次 DOM diff，且大多数是不可见的浪费。改成「只渲染当前 scrollLeft +
 * viewportWidth 覆盖到的那段」。tickPx = tickIntervalMs * pxPerMs 用作
 * 单 tick 宽度，按 scrollLeft 算 startTickIndex / endTickIndex，再用绝对
 * 定位让标尺紧贴可见区。content scrollLeft 变化时 ruler 自然跟随。
 */
function TimeRuler({
  pxPerMs,
  scrollLeft,
  viewportWidth,
  contentWidthPx,
  onClick,
  clickable
}: {
  pxPerMs: number
  scrollLeft: number
  viewportWidth: number
  contentWidthPx: number
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void
  clickable: boolean
}): React.JSX.Element {
  const tickIntervalMs = pickTickInterval(pxPerMs)
  const tickPx = tickIntervalMs * pxPerMs
  // viewport 还没测到时退化为渲染前 24 个 tick（约一屏内的合理量）
  const effectiveWidth = viewportWidth > 0 ? viewportWidth : 24 * tickPx
  // 多渲染左右各 4 个 tick 作为缓冲，避免快速滚动时露出空白
  const overscan = 4
  const startTick = Math.max(0, Math.floor(scrollLeft / tickPx) - overscan)
  const endTick = Math.ceil((scrollLeft + effectiveWidth) / tickPx) + overscan

  const ticks: React.JSX.Element[] = []
  for (let i = startTick; i < endTick; i++) {
    ticks.push(
      <div
        key={i}
        style={{ position: 'absolute', left: i * tickPx, width: tickPx }}
        className="flex h-full items-end border-r border-border-subtle pb-0.5 pl-1 font-mono text-[9px] text-fg-dim"
      >
        {formatRulerLabel(i * tickIntervalMs)}
      </div>
    )
  }

  // ruler 自身处理点击 → 把屏幕坐标转换成时间轴 ms 的工作放在父级
  // onRulerClick 里。这里只负责挂事件 + 视觉上提示「可点」（idle 时
  // 用 cursor-pointer，播放中改成 default 暗示不接受 seek）
  return (
    <div
      onClick={onClick}
      className={cn(
        'sticky top-0 z-30 h-6 border-b border-border bg-bg-deep select-none',
        clickable ? 'cursor-pointer' : 'cursor-default'
      )}
      style={{ width: contentWidthPx }}
    >
      <div className="relative h-full" style={{ width: contentWidthPx }}>
        {ticks}
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
