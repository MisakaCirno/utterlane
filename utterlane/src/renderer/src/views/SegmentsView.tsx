import { useCallback, useEffect, useRef, useState } from 'react'
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
import { cn } from '@renderer/lib/cn'
import { formatDuration } from '@renderer/lib/format'
import { Circle, CircleCheck, FileText, Layers, GripVertical } from 'lucide-react'

function StatusCell({ count }: { count: number }): React.JSX.Element {
  if (count === 0) {
    return (
      <span className="flex items-center gap-1 text-fg-dim">
        <Circle size={11} />
        未录制
      </span>
    )
  }
  if (count === 1) {
    return (
      <span className="flex items-center gap-1 text-ok">
        <CircleCheck size={11} />
        已录制
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-ok">
      <Layers size={11} />多 Take
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
 * 空列表时显示的引导。新建工程之后 Segments 为空，
 * 让用户一眼知道下一步该做什么。
 */
function EmptySegmentsHint(): React.JSX.Element {
  const openImportScript = useDialogStore((s) => s.openImportScript)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-8 text-center">
      <FileText size={24} className="text-fg-dim" />
      <div className="text-xs text-fg">还没有任何 Segment</div>
      <div className="text-2xs text-fg-muted">把文案粘贴进来，每一行会被拆成一个 Segment</div>
      <button
        onClick={openImportScript}
        className={cn(
          'mt-1 rounded-sm border border-accent bg-accent px-3 py-1 text-2xs text-white',
          'hover:bg-accent/90'
        )}
      >
        导入文案
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
  const selectSegment = useEditorStore((s) => s.selectSegment)

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

  return (
    <div
      ref={combinedRef}
      onClick={() => selectSegment(id)}
      style={style}
      className={cn(
        'group grid h-8 cursor-default items-center border-b border-border-subtle text-xs',
        selected ? 'bg-accent-soft text-white' : 'hover:bg-bg-raised',
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
  const order = useEditorStore((s) => s.order)
  const reorderSegments = useEditorStore((s) => s.reorderSegments)

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

  return (
    <div className="flex h-full flex-col bg-bg">
      <div
        className="grid h-7 shrink-0 items-center border-b border-border bg-bg-panel text-2xs text-fg-muted"
        style={gridStyle}
      >
        <div className="h-full" />
        <div className="relative h-full px-2 text-right leading-7">
          #
          <ResizeHandle onMouseDown={(e) => startDrag('orderText', e)} />
        </div>
        <div className="relative h-full px-2 leading-7">
          文案
          <ResizeHandle onMouseDown={(e) => startDrag('textStatus', e)} />
        </div>
        <div className="relative h-full px-2 leading-7">
          状态
          <ResizeHandle onMouseDown={(e) => startDrag('statusTakes', e)} />
        </div>
        <div className="relative h-full px-2 text-right leading-7">
          Takes
          <ResizeHandle onMouseDown={(e) => startDrag('takesDuration', e)} />
        </div>
        <div className="px-2 text-right leading-7">时长</div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {order.length === 0 ? <EmptySegmentsHint /> : null}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map((id, idx) => (
              <SegmentRow key={id} id={id} idx={idx} gridStyle={gridStyle} />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}
