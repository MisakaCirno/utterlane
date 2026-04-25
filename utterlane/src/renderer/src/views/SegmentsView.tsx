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
import { showError, showSuccess } from '@renderer/store/toastStore'
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
  X,
  Plus,
  ArrowUpFromLine,
  ArrowDownFromLine,
  Eraser,
  FileInput,
  Pilcrow,
  Replace
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
  highlight,
  gridStyle
}: {
  id: string
  idx: number
  /**
   * 当前查找关键字。非空时，行文本里的所有匹配段会被高亮成 mark 风格。
   * 空字符串 / undefined 不高亮（避免空字符串走 split 的边界 case）
   */
  highlight: string
  gridStyle: React.CSSProperties
}): React.JSX.Element | null {
  const seg = useEditorStore((s) => s.segmentsById[id])
  const selected = useEditorStore((s) => s.selectedSegmentId === id)
  const extraSelected = useEditorStore((s) => s.extraSelectedSegmentIds.has(id))
  const selectSegmentExtended = useEditorStore((s) => s.selectSegmentExtended)
  const editSegmentText = useEditorStore((s) => s.editSegmentText)
  // 段首推导：order 中的第 0 个或显式 paragraphStart === true。
  // useEditorStore 直接订阅 idx === 0 的衍生量需要 order 的引用；用 idx 参数
  // 已经传进来，此处只看 paragraphStart 一项即可
  const isParagraphHead = idx === 0 || !!seg?.paragraphStart

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

  // 内联编辑：双击文本格进入。draft 跟踪编辑中文本，提交时统一调
  // editSegmentText（自动并入 undo coalesce 窗）
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

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
    // 内联编辑中点击文本格已经被 stopPropagation 拦下，这里只处理非编辑态
    // 修饰键映射：Shift = range；Ctrl/Cmd = toggle；其他 = single
    if (e.shiftKey) selectSegmentExtended(id, 'range')
    else if (e.ctrlKey || e.metaKey) selectSegmentExtended(id, 'toggle')
    else selectSegmentExtended(id, 'single')
  }

  function startEditing(e: React.MouseEvent): void {
    e.stopPropagation()
    setDraft(seg!.text)
    setEditing(true)
  }
  function commit(): void {
    if (!editing) return
    setEditing(false)
    if (draft !== seg!.text) editSegmentText(id, draft)
  }
  function cancel(): void {
    setEditing(false)
  }

  return (
    <div
      ref={combinedRef}
      onClick={onRowClick}
      style={style}
      className={cn(
        'group grid h-8 cursor-default items-center text-xs',
        // 段首行：上方加一道实线，让段落分组视觉清晰；首段（idx === 0）不加，
        // 否则会顶到 header 边界看着糊
        isParagraphHead && idx > 0
          ? 'border-t-2 border-t-border border-b border-b-border-subtle'
          : 'border-b border-border-subtle',
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
        className={cn(
          'flex items-center justify-end gap-1 px-2 tabular-nums',
          selected ? 'text-white/80' : 'text-fg-dim'
        )}
      >
        {/*
          段首标记 ¶（Pilcrow）。tooltip 提示这是段首；视觉上不抢序号的位置，
          用低强度图标即可
        */}
        {isParagraphHead && (
          <Pilcrow
            size={10}
            className={selected ? 'text-white/70' : 'text-accent'}
            aria-label="paragraph start"
          />
        )}
        <span>{idx + 1}</span>
      </div>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancel()
            }
          }}
          className={cn(
            'mx-1 h-6 min-w-0 rounded-sm border border-accent bg-bg-deep px-1.5 text-xs',
            'text-fg outline-none'
          )}
        />
      ) : (
        <div onDoubleClick={startEditing} title={seg.text} className="min-w-0 truncate px-2">
          <HighlightedText text={seg.text} highlight={highlight} dim={selected} />
        </div>
      )}
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

/**
 * 顶部工具栏的 26x26 图标按钮。带 active / danger / disabled 三种态
 */
function ToolbarIconButton({
  children,
  onClick,
  disabled,
  active,
  danger,
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  active?: boolean
  danger?: boolean
  title: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-accent bg-accent text-white'
          : danger
            ? 'border-border bg-bg-raised text-fg-muted hover:border-rec hover:text-rec'
            : 'border-border bg-bg-raised text-fg-muted hover:border-border-strong hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}

/**
 * VSCode 风格的悬浮查找 / 替换小窗口。
 *
 * 覆盖在 SegmentsView 右上角（z-30 高于行但低于 dialog），不挤占工具栏空间。
 * Find 输入实时过滤行；Replace 按钮一次替换全部出现的子串。
 *
 * 不做「逐个替换 + 当前匹配位置」的 VSCode 完整模式——文本编辑场景下
 * Replace All 已经覆盖大部分需求，逐个替换可以用内联编辑加 undo 替代
 */
function FindReplacePanel({
  findText,
  replaceText,
  onFindChange,
  onReplaceChange,
  onReplaceAll,
  onClose,
  matchCount,
  disabled
}: {
  findText: string
  replaceText: string
  onFindChange: (v: string) => void
  onReplaceChange: (v: string) => void
  onReplaceAll: () => void
  onClose: () => void
  matchCount: number
  disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const findInputRef = useRef<HTMLInputElement | null>(null)

  // 面板打开时自动聚焦 find 框；用户能立刻输入查找词
  useEffect(() => {
    findInputRef.current?.focus()
    findInputRef.current?.select()
  }, [])

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // 在 replace 框按 Enter 触发 Replace All；在 find 框按 Enter 当前不动
      // （findText 已经实时同步了过滤结果）
      e.preventDefault()
      if ((e.target as HTMLElement).getAttribute('data-role') === 'replace') {
        onReplaceAll()
      }
    }
  }

  return (
    <div
      onKeyDown={onKeyDown}
      className={cn(
        'absolute right-2 top-10 z-30 flex flex-col gap-1 rounded-sm border border-border',
        'bg-bg-panel p-1.5 shadow-xl text-2xs'
      )}
      style={{ width: 280 }}
    >
      <div className="flex items-center gap-1">
        <Search size={10} className="shrink-0 text-fg-dim" />
        <input
          ref={findInputRef}
          value={findText}
          onChange={(e) => onFindChange(e.target.value)}
          placeholder={t('segments.find_placeholder')}
          className={cn(
            'h-5 flex-1 rounded-sm border border-border bg-bg-deep px-1.5 text-fg',
            'outline-none focus:border-accent'
          )}
        />
        <span className="w-12 shrink-0 text-right text-fg-dim">{findText ? matchCount : ''}</span>
        <button
          onClick={onClose}
          className="rounded-sm p-0.5 text-fg-muted hover:bg-chrome-hover hover:text-fg"
          aria-label={t('common.close')}
        >
          <X size={10} />
        </button>
      </div>
      <div className="flex items-center gap-1">
        <Replace size={10} className="shrink-0 text-fg-dim" />
        <input
          data-role="replace"
          value={replaceText}
          onChange={(e) => onReplaceChange(e.target.value)}
          placeholder={t('segments.replace_placeholder')}
          className={cn(
            'h-5 flex-1 rounded-sm border border-border bg-bg-deep px-1.5 text-fg',
            'outline-none focus:border-accent'
          )}
        />
        <button
          onClick={onReplaceAll}
          disabled={disabled || !findText}
          className={cn(
            'h-5 rounded-sm border border-accent bg-accent px-2 text-white',
            'disabled:cursor-not-allowed disabled:opacity-40 hover:opacity-90'
          )}
        >
          {t('segments.replace_all')}
        </button>
      </div>
    </div>
  )
}

/**
 * 把 highlight 子串在 text 里的所有出现都包成 <mark>。dim 模式下高亮色
 * 调暗，避免在选中行（accent 底色）上撞色
 */
function HighlightedText({
  text,
  highlight,
  dim
}: {
  text: string
  highlight: string
  dim: boolean
}): React.JSX.Element {
  if (!highlight) return <>{text}</>
  const parts = text.split(highlight)
  if (parts.length === 1) return <>{text}</>
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <mark
              className={cn(
                'rounded-sm px-0.5',
                dim ? 'bg-yellow-500/40 text-white' : 'bg-yellow-500/60 text-bg'
              )}
            >
              {highlight}
            </mark>
          )}
        </span>
      ))}
    </>
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
  const newSegment = useEditorStore((s) => s.newSegment)
  const insertSegmentBefore = useEditorStore((s) => s.insertSegmentBefore)
  const insertSegmentAfter = useEditorStore((s) => s.insertSegmentAfter)
  const clearAllSegments = useEditorStore((s) => s.clearAllSegments)
  const replaceAllInSegments = useEditorStore((s) => s.replaceAllInSegments)
  const playback = useEditorStore((s) => s.playback)
  const openImportScript = useDialogStore((s) => s.openImportScript)

  // 查找 / 替换：唯一的「过滤 + 文字操作」入口。
  // findText 为空时不过滤；非空时按子串匹配（大小写敏感，简化版）
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [replaceText, setReplaceText] = useState('')

  const filteredOrder = (() => {
    if (!findText) return order
    return order.filter((id) => segmentsById[id]?.text.includes(findText))
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

  async function onClearAll(): Promise<void> {
    const ok = await confirm({
      title: t('confirm.clear_all_segments_title', { count: order.length }),
      description: t('confirm.clear_all_segments_description'),
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (ok) clearAllSegments()
  }

  function handleReplaceAll(): void {
    if (!findText) return
    const n = replaceAllInSegments(findText, replaceText)
    if (n === 0) {
      showError(t('segments.replace_none_title'), t('segments.replace_none_desc'))
    } else {
      showSuccess(t('segments.replace_done_title'), t('segments.replace_done_desc', { count: n }))
    }
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

  const isIdle = playback === 'idle'
  const showBatchActions = totalSelected > 1 && isIdle
  const hasSelection = !!selectedSegmentId

  return (
    <div className="relative flex h-full flex-col bg-bg">
      {/*
        顶部动作工具栏：始终显示，新建 / 插入 / 删除 / 清空 / 导入 / 查找替换
        几个核心动作都集中在这里。空工程也展示，因为「新建」和「导入」是
        「从无到有」的入口
      */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-bg-panel px-2 text-2xs">
        <ToolbarIconButton
          onClick={() => newSegment()}
          disabled={!isIdle}
          title={t('segments.tb_new')}
        >
          <Plus size={12} />
        </ToolbarIconButton>
        <ToolbarIconButton
          onClick={() => selectedSegmentId && insertSegmentBefore(selectedSegmentId)}
          disabled={!isIdle || !hasSelection}
          title={t('segments.tb_insert_before')}
        >
          <ArrowUpFromLine size={12} />
        </ToolbarIconButton>
        <ToolbarIconButton
          onClick={() => selectedSegmentId && insertSegmentAfter(selectedSegmentId)}
          disabled={!isIdle || !hasSelection}
          title={t('segments.tb_insert_after')}
        >
          <ArrowDownFromLine size={12} />
        </ToolbarIconButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarIconButton
          onClick={() => void onBatchDelete()}
          disabled={!isIdle || totalSelected === 0}
          title={t('segments.tb_delete_selected')}
          danger
        >
          <Trash2 size={12} />
        </ToolbarIconButton>
        <ToolbarIconButton
          onClick={() => void onClearAll()}
          disabled={!isIdle || order.length === 0}
          title={t('segments.tb_clear_all')}
          danger
        >
          <Eraser size={12} />
        </ToolbarIconButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarIconButton
          onClick={openImportScript}
          disabled={!isIdle}
          title={t('segments.tb_import_script')}
        >
          <FileInput size={12} />
        </ToolbarIconButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarIconButton
          onClick={() => setFindOpen((v) => !v)}
          active={findOpen}
          title={t('segments.tb_find_replace')}
        >
          <Search size={12} />
        </ToolbarIconButton>

        {/* 选中数量徽标 + 过滤匹配数：靠右 */}
        <div className="ml-auto flex items-center gap-2 text-fg-dim">
          {showBatchActions && (
            <span>{t('segments.batch_selected', { count: totalSelected })}</span>
          )}
          {findText && (
            <span>
              {t('segments.search_match_count', {
                count: filteredOrder.length,
                total: order.length
              })}
            </span>
          )}
        </div>
      </div>

      {/*
        悬浮查找 / 替换面板。绝对定位在 SegmentsView 右上角内侧（避开
        toolbar 高度），关闭时不挂载，避免 input 在隐藏状态下还吃焦点
      */}
      {findOpen && (
        <FindReplacePanel
          findText={findText}
          replaceText={replaceText}
          onFindChange={setFindText}
          onReplaceChange={setReplaceText}
          onReplaceAll={handleReplaceAll}
          onClose={() => {
            setFindOpen(false)
            setFindText('')
            setReplaceText('')
          }}
          matchCount={findText ? filteredOrder.length : 0}
          disabled={!isIdle}
        />
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
          highlight={findText}
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
  onDragEnd,
  highlight
}: {
  filteredOrder: string[]
  fullOrder: string[]
  gridStyle: React.CSSProperties
  sensors: ReturnType<typeof useSensors>
  onDragEnd: (e: DragEndEvent) => void
  /** 透传给每行的查找高亮关键字 */
  highlight: string
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
                <SegmentRow
                  key={id}
                  id={id}
                  idx={orderIndex.get(id) ?? 0}
                  highlight={highlight}
                  gridStyle={gridStyle}
                />
              ))}
            </div>
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
