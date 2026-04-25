import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEditorStore } from '@renderer/store/editorStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { useDialogStore } from '@renderer/store/dialogStore'
import { confirm } from '@renderer/store/confirmStore'
import { cn } from '@renderer/lib/cn'
import { formatDuration } from '@renderer/lib/format'
import {
  Circle,
  CircleCheck,
  FileText,
  Layers,
  GripVertical,
  Search,
  Trash2,
  X
} from 'lucide-react'

function StatusCell({ count }: { count: number }): React.JSX.Element {
  const { t } = useTranslation()
  if (count === 0) {
    return (
      <span className="flex items-center gap-1 text-fg-dim">
        <Circle size={11} />
        {t('segments.status_unrecorded')}
      </span>
    )
  }
  if (count === 1) {
    return (
      <span className="flex items-center gap-1 text-ok">
        <CircleCheck size={11} />
        {t('segments.status_recorded')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-ok">
      <Layers size={11} />
      {t('segments.status_multi_take')}
    </span>
  )
}

type ColWidths = {
  order: number
  status: number
  takes: number
  duration: number
}

type Divider = 'orderText' | 'textStatus' | 'statusTakes' | 'takesDuration'

const MIN_WIDTHS = {
  order: 32,
  status: 64,
  takes: 40,
  duration: 64
}

const DEFAULT_WIDTHS: ColWidths = {
  order: 44,
  status: 80,
  takes: 56,
  duration: 80
}

function buildGridTemplate(w: ColWidths): string {
  return `28px ${w.order}px 1fr ${w.status}px ${w.takes}px ${w.duration}px`
}

/**
 * 虚拟化参数。
 *
 * ROW_HEIGHT 必须与 SegmentRow 上的 className `h-8`（即 32px）保持一致——
 * 一旦行高变了这里也要改，否则虚拟化算出的可见区与实际位置错位。
 *
 * OVERSCAN：可见窗上下各多渲染的行数。给 dnd-kit 拖拽预留缓冲，避免拖到
 * 边缘时目标行还没进 DOM
 */
const ROW_HEIGHT = 32
const OVERSCAN = 8

/**
 * 空列表时显示的引导。新建工程之后 Segments 为空，
 * 让用户一眼知道下一步该做什么。
 */
function EmptySegmentsHint(): React.JSX.Element {
  const { t } = useTranslation()
  const openImportScript = useDialogStore((s) => s.openImportScript)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <FileText size={24} className="text-fg-dim" />
      <div className="text-xs text-fg">{t('segments.empty_title')}</div>
      <div className="text-2xs text-fg-muted">{t('segments.empty_hint')}</div>
      <button
        onClick={openImportScript}
        className={cn(
          'mt-1 rounded-sm border border-accent bg-accent px-3 py-1 text-2xs text-white',
          'hover:bg-accent/90'
        )}
      >
        {t('segments.empty_action')}
      </button>
    </div>
  )
}

function ResizeHandle({
  onMouseDown
}: {
  onMouseDown: (e: React.MouseEvent) => void
}): React.JSX.Element {
  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        'absolute top-0 -right-px bottom-0 z-10 w-[5px] cursor-col-resize',
        'hover:bg-accent/50 active:bg-accent'
      )}
    />
  )
}

/**
 * 单行 Segment。用 @dnd-kit 的 useSortable 得到 transform + listeners，
 * 只把 listeners 绑在左侧 GripVertical 上（而不是整行），
 * 这样行的其他区域仍然响应 click 选中 / 双击编辑。
 */
function SegmentRow({
  id,
  idx,
  gridStyle
}: {
  id: string
  idx: number
  gridStyle: React.CSSProperties
}): React.JSX.Element | null {
  const seg = useEditorStore((s) => s.segmentsById[id])
  const selected = useEditorStore((s) => s.selectedSegmentId === id)
  const extraSelected = useEditorStore((s) => s.extraSelectedSegmentIds.has(id))
  const selectSegmentExtended = useEditorStore((s) => s.selectSegmentExtended)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  })

  // 合并 dnd-kit 的 ref 和自己的 ref：前者要求受控于 setNodeRef，
  // 后者用于 scrollIntoView。callback ref 同时喂给两边。
  const rowElementRef = useRef<HTMLDivElement | null>(null)
  const combinedRef = (el: HTMLDivElement | null): void => {
    rowElementRef.current = el
    setNodeRef(el)
  }

  // 选中变化时把自己滚动到可见区域。block: 'nearest' 保证元素已经可见时不滚，
  // 这样用户手动滚到某处然后点其他行不会被意外拉回。
  useEffect(() => {
    if (selected && rowElementRef.current) {
      rowElementRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  if (!seg) return null
  const current = seg.takes.find((t) => t.id === seg.selectedTakeId)
  const duration = current?.durationMs ?? 0

  // dnd-kit 在拖拽中通过 transform 以 translate3d 视觉偏移；
  // transition 让松手归位有动画；isDragging 时提权层级 + 高亮
  const style: React.CSSProperties = {
    ...gridStyle,
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined
  }

  const onRowClick = (e: React.MouseEvent): void => {
    // 修饰键映射：Shift = range；Ctrl/Cmd = toggle；其他 = single。
    // metaKey 兼容 macOS 用 Cmd
    if (e.shiftKey) selectSegmentExtended(id, 'range')
    else if (e.ctrlKey || e.metaKey) selectSegmentExtended(id, 'toggle')
    else selectSegmentExtended(id, 'single')
  }

  return (
    <div
      ref={combinedRef}
      onClick={onRowClick}
      style={style}
      className={cn(
        'group grid h-8 cursor-default items-center border-b border-border-subtle text-xs',
        selected
          ? 'bg-accent-soft text-white'
          : extraSelected
            ? // 副选中：用低饱和的 accent 让多选可见但又区别于主选
              'bg-accent-soft/40 text-fg'
            : 'hover:bg-bg-raised',
        isDragging && 'bg-bg-raised shadow-lg ring-1 ring-accent'
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'flex h-full cursor-grab items-center justify-center text-fg-dim',
          'opacity-0 group-hover:opacity-100 active:cursor-grabbing'
        )}
        // 把 drag handle 的点击 / 双击事件拦下来，避免触发行的选中逻辑
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={12} />
      </div>
      <div
        className={cn('px-2 text-right tabular-nums', selected ? 'text-white/80' : 'text-fg-dim')}
      >
        {idx + 1}
      </div>
      <div className="min-w-0 truncate px-2">{seg.text}</div>
      <div className="px-2">
        <StatusCell count={seg.takes.length} />
      </div>
      <div
        className={cn('px-2 text-right tabular-nums', selected ? 'text-white/80' : 'text-fg-muted')}
      >
        {seg.takes.length}
      </div>
      <div
        className={cn(
          'px-2 text-right font-mono text-2xs tabular-nums',
          selected ? 'text-white/80' : 'text-fg-muted'
        )}
      >
        {duration > 0 ? formatDuration(duration) : '—'}
      </div>
    </div>
  )
}

export function SegmentsView(): React.JSX.Element {
  const { t } = useTranslation()
  const order = useEditorStore((s) => s.order)
  const segmentsById = useEditorStore((s) => s.segmentsById)
  const reorderSegments = useEditorStore((s) => s.reorderSegments)
  const extraSelectedCount = useEditorStore((s) => s.extraSelectedSegmentIds.size)
  const selectedSegmentId = useEditorStore((s) => s.selectedSegmentId)
  const deleteSelectedSegments = useEditorStore((s) => s.deleteSelectedSegments)
  const playback = useEditorStore((s) => s.playback)

  // 搜索仅作为前端过滤：不修改 order，只决定哪些行显示。
  // 不持久化，刷新即清空——用户预期搜索是「临时聚焦」工具
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const filteredOrder = (() => {
    if (!search) return order
    const q = search.toLowerCase()
    return order.filter((id) => segmentsById[id]?.text.toLowerCase().includes(q))
  })()

  // 主选中存在时算入「已选总数」；副选不含主选（store 不变量）
  const totalSelected = (selectedSegmentId ? 1 : 0) + extraSelectedCount

  async function onBatchDelete(): Promise<void> {
    const ok = await confirm({
      title: t('confirm.delete_segments_title', { count: totalSelected }),
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (ok) deleteSelectedSegments()
  }

  // 初始列宽从 preferences 读，缺项回落默认。
  // 拖拽过程用本地 state 做流畅回显（不走 IPC 每帧往返），松手时再写回 preferences。
  // preferences 在运行期的外部变更（例如设置对话框重置）不会实时同步到这里——
  // 场景极少，暂不值得为此加订阅副作用。
  const [widths, setWidths] = useState<ColWidths>(() => {
    const saved = usePreferencesStore.getState().prefs.layout?.segmentsColumnWidths
    return {
      order: saved?.order ?? DEFAULT_WIDTHS.order,
      status: saved?.status ?? DEFAULT_WIDTHS.status,
      takes: saved?.takes ?? DEFAULT_WIDTHS.takes,
      duration: saved?.duration ?? DEFAULT_WIDTHS.duration
    }
  })
  const gridStyle = { gridTemplateColumns: buildGridTemplate(widths) }

  const dragRef = useRef<{ startX: number; start: ColWidths; divider: Divider } | null>(null)

  const startDrag = useCallback(
    (divider: Divider, e: React.MouseEvent) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, start: { ...widths }, divider }
      document.body.style.cursor = 'col-resize'

      const onMove = (ev: MouseEvent): void => {
        const ctx = dragRef.current
        if (!ctx) return
        const dx = ev.clientX - ctx.startX
        const { start } = ctx

        setWidths(() => {
          const next = { ...start }
          switch (ctx.divider) {
            case 'orderText':
              next.order = Math.max(MIN_WIDTHS.order, start.order + dx)
              break
            case 'textStatus':
              next.status = Math.max(MIN_WIDTHS.status, start.status - dx)
              break
            case 'statusTakes': {
              const proposedStatus = start.status + dx
              const newStatus = Math.max(MIN_WIDTHS.status, proposedStatus)
              const consumed = newStatus - start.status
              let newTakes = start.takes - consumed
              if (newTakes < MIN_WIDTHS.takes) {
                newTakes = MIN_WIDTHS.takes
                next.status = start.status + (start.takes - MIN_WIDTHS.takes)
              } else {
                next.status = newStatus
              }
              next.takes = newTakes
              break
            }
            case 'takesDuration': {
              const proposedTakes = start.takes + dx
              const newTakes = Math.max(MIN_WIDTHS.takes, proposedTakes)
              const consumed = newTakes - start.takes
              let newDuration = start.duration - consumed
              if (newDuration < MIN_WIDTHS.duration) {
                newDuration = MIN_WIDTHS.duration
                next.takes = start.takes + (start.duration - MIN_WIDTHS.duration)
              } else {
                next.takes = newTakes
              }
              next.duration = newDuration
              break
            }
          }
          return next
        })
      }

      const onUp = (): void => {
        dragRef.current = null
        document.body.style.cursor = ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        // 拖拽结束后把最终列宽写进 preferences。
        // 用 setWidths((w) => w) 的 setter 拿到最新值，避免闭包里的 widths 是旧值。
        setWidths((finalWidths) => {
          usePreferencesStore.getState().update({ layout: { segmentsColumnWidths: finalWidths } })
          return finalWidths
        })
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [widths]
  )

  // 拖拽传感器：要求指针移动 4px 后才判定为拖拽，
  // 避免 GripVertical 的单击误触发 drag（用户可能只想点一下）
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const handleDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = order.indexOf(String(active.id))
    const to = order.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    reorderSegments(arrayMove(order, from, to))
  }

  // 搜索栏 + 批量条只在「有内容可显示」或「有选中需要批量操作」时占空间，
  // 避免新建工程时空状态被占据视觉重心
  const showToolbar = order.length > 0
  const showBatchActions = totalSelected > 1 && playback === 'idle'

  return (
    <div className="flex h-full flex-col bg-bg">
      {showToolbar && (
        <div className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-bg-panel px-2 text-2xs">
          {/*
            搜索折叠按钮：默认收起省空间，点击展开 input。展开后再点空 X 收起。
            过滤是纯渲染层操作，不动 segments
          */}
          {searchOpen ? (
            <div className="flex flex-1 items-center gap-1">
              <Search size={11} className="text-fg-dim" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('segments.search_placeholder')}
                className={cn(
                  'h-5 flex-1 rounded-sm border border-border bg-bg-deep px-1.5 text-2xs text-fg',
                  'outline-none focus:border-accent'
                )}
              />
              <button
                onClick={() => {
                  setSearch('')
                  setSearchOpen(false)
                }}
                className="rounded-sm p-0.5 text-fg-muted hover:bg-chrome-hover hover:text-fg"
                aria-label={t('common.close')}
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-fg-muted hover:bg-chrome-hover hover:text-fg"
            >
              <Search size={11} />
              <span>{t('segments.search')}</span>
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
            {showBatchActions && (
              <>
                <span className="text-fg-muted">
                  {t('segments.batch_selected', { count: totalSelected })}
                </span>
                <button
                  onClick={() => void onBatchDelete()}
                  className={cn(
                    'flex items-center gap-1 rounded-sm border border-border bg-bg-raised px-2 py-0.5',
                    'text-fg hover:border-rec hover:text-rec'
                  )}
                >
                  <Trash2 size={10} />
                  {t('segments.batch_delete')}
                </button>
              </>
            )}
            {search && (
              <span className="text-fg-dim">
                {t('segments.search_match_count', {
                  count: filteredOrder.length,
                  total: order.length
                })}
              </span>
            )}
          </div>
        </div>
      )}
      <div
        className="grid h-7 shrink-0 items-center border-b border-border bg-bg-panel text-2xs text-fg-muted"
        style={gridStyle}
      >
        <div className="h-full" />
        <div className="relative h-full px-2 text-right leading-7">
          {t('segments.col_order')}
          <ResizeHandle onMouseDown={(e) => startDrag('orderText', e)} />
        </div>
        <div className="relative h-full px-2 leading-7">
          {t('segments.col_text')}
          <ResizeHandle onMouseDown={(e) => startDrag('textStatus', e)} />
        </div>
        <div className="relative h-full px-2 leading-7">
          {t('segments.col_status')}
          <ResizeHandle onMouseDown={(e) => startDrag('statusTakes', e)} />
        </div>
        <div className="relative h-full px-2 text-right leading-7">
          {t('segments.col_takes')}
          <ResizeHandle onMouseDown={(e) => startDrag('takesDuration', e)} />
        </div>
        <div className="px-2 text-right leading-7">{t('segments.col_duration')}</div>
      </div>

      {order.length === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <EmptySegmentsHint />
        </div>
      ) : (
        <VirtualizedRows
          filteredOrder={filteredOrder}
          fullOrder={order}
          gridStyle={gridStyle}
          sensors={sensors}
          onDragEnd={handleDragEnd}
        />
      )}
    </div>
  )
}

/**
 * 虚拟化的行容器：仅渲染 viewport 可见 + overscan 范围内的行。
 *
 * 实现要点：
 *   - 监听 scroll + ResizeObserver 跟踪 scrollTop / containerHeight
 *   - SortableContext.items 喂全量 filteredOrder，dnd-kit 知道完整顺序；
 *     useSortable 只挂在 visible 行上，拖拽时靠 dnd-kit 的 autoScroll 把
 *     目标行滚进 viewport 即可被识别为 drop target
 *   - 容器内放一个 totalHeight 高度的占位 div 撑出滚动条，可见行用绝对定位
 *     按 startIdx * ROW_HEIGHT 偏移
 *   - orderIndex Map 给序号列查 O(1) 下标，避免每行 array.indexOf 的 O(n)
 */
function VirtualizedRows({
  filteredOrder,
  fullOrder,
  gridStyle,
  sensors,
  onDragEnd
}: {
  filteredOrder: string[]
  fullOrder: string[]
  gridStyle: React.CSSProperties
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (e: DragEndEvent) => void
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    setContainerHeight(el.clientHeight)
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight))
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // 全量 order 的下标查找：保留虚拟化下序号列正确显示
  const orderIndex = (() => {
    const m = new Map<string, number>()
    for (let i = 0; i < fullOrder.length; i++) m.set(fullOrder[i], i)
    return m
  })()

  const totalHeight = filteredOrder.length * ROW_HEIGHT
  // 容器高度尚未测量（首帧）时回落渲染前 30 行，避免空白闪烁
  const effectiveHeight = containerHeight > 0 ? containerHeight : 30 * ROW_HEIGHT
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIdx = Math.min(
    filteredOrder.length,
    Math.ceil((scrollTop + effectiveHeight) / ROW_HEIGHT) + OVERSCAN
  )
  const visibleIds = filteredOrder.slice(startIdx, endIdx)
  const offsetTop = startIdx * ROW_HEIGHT

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={filteredOrder} strategy={verticalListSortingStrategy}>
          {/*
            外层 div 高度 = totalHeight，撑出滚动条；内层 div 用绝对定位
            按 offsetTop 偏移，仅渲染可见区块的行
          */}
          <div style={{ height: totalHeight, position: 'relative' }}>
            <div style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
              {visibleIds.map((id) => (
                <SegmentRow key={id} id={id} idx={orderIndex.get(id) ?? 0} gridStyle={gridStyle} />
              ))}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
