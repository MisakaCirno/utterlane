import { Activity, Check, CircleDot, Layers, Mic2 } from 'lucide-react'
import { useEditorStore } from '@renderer/store/editorStore'
import { cn } from '@renderer/lib/cn'

export function StatusBar(): React.JSX.Element {
  const project = useEditorStore((s) => s.project)
  const saved = useEditorStore((s) => s.saved)
  const playback = useEditorStore((s) => s.playback)
  const order = useEditorStore((s) => s.order)
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )

  const segIndex = selectedId ? order.indexOf(selectedId) : -1
  const takeCount = segment?.takes.length ?? 0
  const currentTakeIdx = segment?.takes.findIndex((t) => t.id === segment.selectedTakeId) ?? -1

  const statusText =
    playback === 'recording'
      ? '正在录音'
      : playback === 'segment'
        ? '正在播放当前句'
        : playback === 'project'
          ? '正在播放项目'
          : takeCount === 0
            ? '未录制'
            : '已录制'

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-chrome px-3 text-2xs text-fg-muted">
      <div className="flex items-center gap-4">
        <span className={cn('flex items-center gap-1', saved ? 'text-fg-muted' : 'text-accent')}>
          {saved ? <Check size={11} /> : <CircleDot size={11} />}
          {saved ? '已保存' : '未保存'}
        </span>
        <span className="flex items-center gap-1">
          <Activity size={11} />
          {project.audio.sampleRate / 1000} kHz · {project.audio.channels === 1 ? 'Mono' : 'Stereo'}
        </span>
        <span className="flex items-center gap-1">
          <Mic2 size={11} />
          默认输入设备
        </span>
      </div>

      <div className="flex items-center gap-4">
        {segIndex >= 0 && (
          <span className="flex items-center gap-1 font-mono tabular-nums">
            <Layers size={11} />
            Segment {segIndex + 1} / {order.length}
          </span>
        )}
        {takeCount > 0 && (
          <span className="font-mono tabular-nums">
            Take {currentTakeIdx + 1} / {takeCount}
          </span>
        )}
        <span className={cn(playback === 'recording' && 'text-rec')}>
          {playback === 'recording' ? (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rec" />
              {statusText}
            </span>
          ) : (
            statusText
          )}
        </span>
        <span>后台任务：无</span>
      </div>
    </div>
  )
}
