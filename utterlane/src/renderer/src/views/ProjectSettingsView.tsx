import { useTranslation } from 'react-i18next'
import { useEditorStore } from '@renderer/store/editorStore'
import { Field } from '@renderer/components/Field'

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="py-1 text-2xs font-semibold uppercase tracking-wider text-fg-dim">
      {children}
    </div>
  )
}

export function ProjectSettingsView(): React.JSX.Element {
  const { t } = useTranslation()
  const project = useEditorStore((s) => s.project)
  const updateProject = useEditorStore((s) => s.updateProject)

  // Workspace 只在有工程时挂载，这里正常不会命中 null；
  // 但保留守卫让类型检查通过，同时覆盖 React 18 挂载时序的边界情况。
  if (!project) return <div className="h-full bg-bg" />

  return (
    <div className="h-full overflow-y-auto bg-bg px-3 py-2">
      <SectionTitle>{t('project_settings.section_info')}</SectionTitle>
      <Field label={t('project_settings.field_title')}>
        <input
          readOnly
          value={project.title}
          className="w-full rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none"
        />
      </Field>
      <Field label={t('project_settings.field_sample_rate')}>
        <select
          className="w-full rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none"
          value={project.audio.sampleRate}
          onChange={() => {}}
        >
          <option value={44100}>44100 Hz</option>
          <option value={48000}>48000 Hz</option>
        </select>
      </Field>
      <Field label={t('project_settings.field_channels')}>
        <select
          className="w-full rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none"
          value={project.audio.channels}
          onChange={() => {}}
        >
          <option value={1}>{t('project_settings.channel_mono')}</option>
          <option value={2}>{t('project_settings.channel_stereo')}</option>
        </select>
      </Field>

      <div className="mt-4">
        <SectionTitle>{t('project_settings.section_text')}</SectionTitle>
      </div>
      <Field label={t('project_settings.field_recommended_max_chars')}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={9999}
            // 用空字符串表达「未设置」让 placeholder 显示出来；
            // 0 也视为「不限制」（数据上等价于 undefined）
            value={
              project.recommendedMaxChars && project.recommendedMaxChars > 0
                ? String(project.recommendedMaxChars)
                : ''
            }
            placeholder={t('project_settings.recommended_max_chars_placeholder')}
            onChange={(e) => {
              const raw = e.target.value
              const n = raw === '' ? 0 : Math.max(0, Math.min(9999, Number(raw) || 0))
              updateProject({ recommendedMaxChars: n > 0 ? n : undefined })
            }}
            className="w-24 rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none focus:border-accent"
          />
          <span className="text-2xs text-fg-dim">
            {t('project_settings.recommended_max_chars_hint')}
          </span>
        </div>
      </Field>

      <div className="mt-4">
        <SectionTitle>{t('project_settings.section_export_defaults')}</SectionTitle>
      </div>
      <Field label={t('project_settings.field_audio_format')}>
        <span className="font-mono text-fg-muted">WAV</span>
      </Field>
      <Field label={t('project_settings.field_subtitle_format')}>
        <span className="font-mono text-fg-muted">SRT</span>
      </Field>

      <div className="mt-4">
        <SectionTitle>{t('project_settings.section_paths')}</SectionTitle>
      </div>
      <Field label={t('project_settings.field_segments_file')}>
        <span className="font-mono text-2xs text-fg-muted">{project.paths.segmentsFile}</span>
      </Field>
      <Field label={t('project_settings.field_audios_dir')}>
        <span className="font-mono text-2xs text-fg-muted">{project.paths.audiosDir}</span>
      </Field>
    </div>
  )
}
