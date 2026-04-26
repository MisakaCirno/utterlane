import { Activity, Check, CircleDot, Layers, Mic2, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useEditorStore } from '@renderer/store/editorStore'
import { useDialogStore } from '@renderer/store/dialogStore'
import { focusPanel } from './workspaceHandle'
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
  const openPreferences = useDialogStore((s) => s.openPreferences)

  // 无工程时状态栏退化成极简模式：左只提示「无活动工程」，右仍然保留
  // 设置按钮——偏好对话框跟具体工程无关，应该恒可达
  if (!project) {
    return (
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-chrome px-3 text-2xs text-fg-dim">
        <span>{t('statusbar.no_project')}</span>
        <SettingsButton onClick={openPreferences} title={t('preferences.menu_entry')} />
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

  // 采样率 / 输入设备所属配置都在 Project Settings 里——点击直接激活那
  // 个 panel，比让用户去 dock tab 找省一步操作；title 提示意图避免
  // 鼠标 hover 时困惑「这是按钮吗」
  const onJumpToProjectSettings = (): void => focusPanel('projectSettings')

  return (
    <div className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-chrome px-3 text-2xs text-fg-muted">
      <div className="flex items-center gap-4">
        <span className={cn('flex items-center gap-1', saved ? 'text-fg-muted' : 'text-accent')}>
          {saved ? <Check size={11} /> : <CircleDot size={11} />}
          {saved ? t('statusbar.saved') : t('statusbar.unsaved')}
        </span>
        <button
          type="button"
          onClick={onJumpToProjectSettings}
          title={t('statusbar.jump_to_project_settings_hint')}
          className="flex items-center gap-1 rounded-sm px-1 hover:bg-chrome-hover hover:text-fg"
        >
          <Activity size={11} />
          {t('statusbar.sample_rate', {
            khz: project.audio.sampleRate / 1000,
            channels:
              project.audio.channels === 1
                ? t('project_settings.channel_mono')
                : t('project_settings.channel_stereo')
          })}
        </button>
        <button
          type="button"
          onClick={onJumpToProjectSettings}
          title={t('statusbar.jump_to_project_settings_hint')}
          className="flex items-center gap-1 rounded-sm px-1 hover:bg-chrome-hover hover:text-fg"
        >
          <Mic2 size={11} />
          {t('statusbar.default_input')}
        </button>
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
        <SettingsButton onClick={openPreferences} title={t('preferences.menu_entry')} />
      </div>
    </div>
  )
}

function SettingsButton({
  onClick,
  title
}: {
  onClick: () => void
  title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-chrome-hover hover:text-fg"
    >
      <Settings size={11} />
    </button>
  )
}
