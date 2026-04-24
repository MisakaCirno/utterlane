import { Activity, Check, CircleDot, Layers, Mic2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEditorStore } from '@renderer/store/editorStore'
import { cn } from '@renderer/lib/cn'

export function StatusBar(): React.JSX.Element {
  const { t } = useTranslation()
  const project = useEditorStore((s) => s.project)
  const saved = useEditorStore((s) => s.saved)
  const playback = useEditorStore((s) => s.playback)
  const paused = useEditorStore((s) => s.paused)
  const order = useEditorStore((s) => s.order)
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )

  // 无工程时状态栏退化成极简模式，只提示「无活动工程」。
  // 不隐藏整条是为了保持整体布局一致，避免窗口内容区随之抖动。
  if (!project) {
    return (
      <div className="flex h-6 shrink-0 items-center border-t border-border bg-chrome px-3 text-2xs text-fg-dim">
        {t('statusbar.no_project')}
      </div>
    )
  }

  const segIndex = selectedId ? order.indexOf(selectedId) : -1
  const takeCount = segment?.takes.length ?? 0
  const currentTakeIdx = segment?.takes.findIndex((t) => t.id === segment.selectedTakeId) ?? -1

  const statusText =
    playback === 'recording'
      ? t('statusbar.playback_recording')
      : playback === 'segment'
        ? paused
          ? t('statusbar.playback_segment_paused')
          : t('statusbar.playback_segment')
        : playback === 'project'
          ? paused
            ? t('statusbar.playback_project_paused')
            : t('statusbar.playback_project')
          : takeCount === 0
            ? t('statusbar.playback_idle_unrecorded')
            : t('statusbar.playback_idle_recorded')

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-chrome px-3 text-2xs text-fg-muted">
      <div className="flex items-center gap-4">
        <span className={cn('flex items-center gap-1', saved ? 'text-fg-muted' : 'text-accent')}>
          {saved ? <Check size={11} /> : <CircleDot size={11} />}
          {saved ? t('statusbar.saved') : t('statusbar.unsaved')}
        </span>
        <span className="flex items-center gap-1">
          <Activity size={11} />
          {t('statusbar.sample_rate', {
            khz: project.audio.sampleRate / 1000,
            channels:
              project.audio.channels === 1
                ? t('project_settings.channel_mono')
                : t('project_settings.channel_stereo')
          })}
        </span>
        <span className="flex items-center gap-1">
          <Mic2 size={11} />
          {t('statusbar.default_input')}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {segIndex >= 0 && (
          <span className="flex items-center gap-1 font-mono tabular-nums">
            <Layers size={11} />
            {t('statusbar.segment_index', { index: segIndex + 1, total: order.length })}
          </span>
        )}
        {takeCount > 0 && (
          <span className="font-mono tabular-nums">
            {t('statusbar.take_index', { index: currentTakeIdx + 1, total: takeCount })}
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
        <span>{t('statusbar.background_none')}</span>
      </div>
    </div>
  )
}
