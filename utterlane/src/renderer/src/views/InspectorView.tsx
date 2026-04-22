import { Play, Square, Mic, RotateCcw, Trash2, Check, Circle } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { formatDuration } from '@renderer/lib/format'
import { Field } from '@renderer/components/Field'

function ToolbarButton({
  children,
  onClick,
  active,
  danger,
  disabled
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-6 items-center gap-1 rounded-sm border px-2 text-2xs',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-accent bg-accent-soft text-white'
          : danger
            ? 'border-border bg-bg-raised text-fg hover:border-rec hover:text-rec'
            : 'border-border bg-bg-raised text-fg hover:border-border-strong hover:bg-chrome-hover'
      )}
    >
      {children}
    </button>
  )
}

export function InspectorView(): React.JSX.Element {
  const order = useEditorStore((s) => s.order)
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )
  const setSelectedTake = useEditorStore((s) => s.setSelectedTake)

  if (!segment || !selectedId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-2xs text-fg-dim">
        未选中 Segment
      </div>
    )
  }

  const index = order.indexOf(selectedId)

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="border-b border-border px-3 py-2">
        <Field label="顺序">
          <span className="font-mono tabular-nums">
            {index + 1} / {order.length}
          </span>
        </Field>
        <Field label="文案">
          <textarea
            value={segment.text}
            readOnly
            className={cn(
              'w-full resize-none rounded-sm border border-border bg-bg-deep px-2 py-1',
              'text-xs leading-5 outline-none focus:border-accent'
            )}
            rows={3}
          />
        </Field>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <ToolbarButton>
          <Play size={11} />
          播放
        </ToolbarButton>
        <ToolbarButton>
          <Square size={11} />
          停止
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        <ToolbarButton>
          <Mic size={11} />
          录音
        </ToolbarButton>
        <ToolbarButton disabled={!segment.selectedTakeId}>
          <RotateCcw size={11} />
          重录
        </ToolbarButton>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-2xs text-fg-muted">Takes</span>
        <span className="text-2xs text-fg-dim">{segment.takes.length} 个</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {segment.takes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-2xs text-fg-dim">
            还没有录音
          </div>
        ) : (
          segment.takes.map((take, i) => {
            const isCurrent = take.id === segment.selectedTakeId
            return (
              <div
                key={take.id}
                className={cn(
                  'flex h-8 items-center gap-2 border-b border-border-subtle px-3 text-xs',
                  isCurrent ? 'bg-accent-soft/40' : 'hover:bg-bg-raised'
                )}
              >
                <div className="flex w-4 items-center justify-center">
                  {isCurrent ? (
                    <Check size={12} className="text-accent" />
                  ) : (
                    <Circle size={8} className="text-fg-dim" />
                  )}
                </div>
                <div className="flex-1 truncate">Take {i + 1}</div>
                <div className="w-16 text-right font-mono text-2xs tabular-nums text-fg-muted">
                  {formatDuration(take.durationMs)}
                </div>
                <button className="rounded-sm p-1 text-fg-muted hover:bg-bg-raised hover:text-fg">
                  <Play size={11} />
                </button>
                <button
                  onClick={() => setSelectedTake(selectedId, take.id)}
                  className={cn(
                    'rounded-sm px-1.5 py-0.5 text-2xs',
                    isCurrent ? 'text-accent' : 'text-fg-muted hover:bg-bg-raised hover:text-fg'
                  )}
                  disabled={isCurrent}
                >
                  {isCurrent ? '当前' : '设为当前'}
                </button>
                <button className="rounded-sm p-1 text-fg-muted hover:bg-bg-raised hover:text-rec">
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
