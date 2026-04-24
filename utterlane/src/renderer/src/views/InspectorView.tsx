import { useEffect, useState } from 'react'
import { Play, Square, Mic, RotateCcw, Trash2, Check, Circle } from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { confirm } from '@renderer/store/confirmStore'
import { formatDuration } from '@renderer/lib/format'
import { Field } from '@renderer/components/Field'
import { subscribeLevel } from '@renderer/services/recorder'

/**
 * 输入电平条。订阅 recorder.subscribeLevel 获取实时 RMS，
 * 用 CSS transform scaleX 做条形指示；切 0.6 之上变黄、0.85 以上变红提示削波风险。
 *
 * RAF 节流：回调可能每 ~20ms 触发一次，靠 requestAnimationFrame 合并到下一帧渲染，
 * 避免 React 高频重渲染。
 */
function LevelMeter(): React.JSX.Element {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    let pending = 0
    let rafId: number | null = null
    const flush = (): void => {
      rafId = null
      setLevel(pending)
    }
    const off = subscribeLevel((l) => {
      pending = l
      if (rafId === null) rafId = requestAnimationFrame(flush)
    })
    return () => {
      off()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  // 视觉范围扩大一下（RMS 普通讲话 0.05~0.2），0.5 ≈ 满刻度的 100%
  const scaled = Math.min(1, level * 2)
  const color = scaled > 0.85 ? 'bg-rec' : scaled > 0.6 ? 'bg-yellow-500' : 'bg-ok'

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <span className="text-2xs text-fg-muted">电平</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-bg-deep">
        <div
          className={cn('h-full origin-left transition-[width] duration-75', color)}
          style={{ width: `${Math.round(scaled * 100)}%` }}
        />
      </div>
    </div>
  )
}

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
  const editSegmentText = useEditorStore((s) => s.editSegmentText)
  const deleteSegment = useEditorStore((s) => s.deleteSegment)
  const setSelectedTake = useEditorStore((s) => s.setSelectedTake)
  const deleteTake = useEditorStore((s) => s.deleteTake)
  const playback = useEditorStore((s) => s.playback)
  const recordingSegmentId = useEditorStore((s) => s.recordingSegmentId)
  const startRecording = useEditorStore((s) => s.startRecordingForSelected)
  const startRerecording = useEditorStore((s) => s.startRerecordingSelected)
  const stopRecording = useEditorStore((s) => s.stopRecordingAndSave)
  const cancelRecording = useEditorStore((s) => s.cancelRecording)
  const playCurrentSegment = useEditorStore((s) => s.playCurrentSegment)
  const stopPlayback = useEditorStore((s) => s.stopPlayback)

  if (!segment || !selectedId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-2xs text-fg-dim">
        未选中 Segment
      </div>
    )
  }

  const index = order.indexOf(selectedId)

  // 只有这条 Segment 正在被录音时才把按钮切换成「停止 / 取消」；
  // 其他 Segment 被录音时，当前这条按钮保持 idle 状态但整体 disabled
  const isRecordingThis = playback === 'recording' && recordingSegmentId === selectedId
  const isRecordingOther = playback === 'recording' && !isRecordingThis

  const onDeleteSegment = async (): Promise<void> => {
    const ok = await confirm({
      title: '删除这条 Segment？',
      description: segment.text,
      confirmLabel: '删除',
      tone: 'danger'
    })
    if (ok) deleteSegment(selectedId)
  }

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
            onChange={(e) => editSegmentText(selectedId, e.target.value)}
            className={cn(
              'w-full resize-none rounded-sm border border-border bg-bg-deep px-2 py-1',
              'text-xs leading-5 outline-none focus:border-accent'
            )}
            rows={3}
          />
        </Field>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <ToolbarButton
          active={playback === 'segment'}
          onClick={playback === 'segment' ? stopPlayback : () => void playCurrentSegment()}
          disabled={
            isRecordingOther || isRecordingThis || playback === 'project' || !segment.selectedTakeId
          }
        >
          {playback === 'segment' ? <Square size={11} /> : <Play size={11} />}
          {playback === 'segment' ? '停止' : '播放'}
        </ToolbarButton>
        <ToolbarButton
          onClick={stopPlayback}
          disabled={isRecordingOther || isRecordingThis || playback === 'idle'}
        >
          <Square size={11} />
          停止
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        {isRecordingThis ? (
          <>
            <ToolbarButton active danger onClick={stopRecording}>
              <Square size={11} />
              停止录音
            </ToolbarButton>
            <ToolbarButton onClick={cancelRecording}>取消</ToolbarButton>
          </>
        ) : (
          <>
            <ToolbarButton onClick={startRecording} disabled={isRecordingOther}>
              <Mic size={11} />
              录音
            </ToolbarButton>
            <ToolbarButton
              onClick={startRerecording}
              disabled={isRecordingOther || !segment.selectedTakeId}
            >
              <RotateCcw size={11} />
              重录
            </ToolbarButton>
          </>
        )}
        <div className="ml-auto" />
        <ToolbarButton danger onClick={onDeleteSegment} disabled={isRecordingThis}>
          <Trash2 size={11} />
          删除 Segment
        </ToolbarButton>
      </div>

      {isRecordingThis && <LevelMeter />}

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
                <button
                  onClick={() => deleteTake(selectedId, take.id)}
                  className="rounded-sm p-1 text-fg-muted hover:bg-bg-raised hover:text-rec"
                  aria-label="删除 Take"
                >
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
