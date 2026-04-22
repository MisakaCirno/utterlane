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
  const project = useEditorStore((s) => s.project)

  return (
    <div className="h-full overflow-y-auto bg-bg px-3 py-2">
      <SectionTitle>工程信息</SectionTitle>
      <Field label="名称">
        <input
          readOnly
          value={project.title}
          className="w-full rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none"
        />
      </Field>
      <Field label="采样率">
        <select
          className="w-full rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none"
          value={project.audio.sampleRate}
          onChange={() => {}}
        >
          <option value={44100}>44100 Hz</option>
          <option value={48000}>48000 Hz</option>
        </select>
      </Field>
      <Field label="声道数">
        <select
          className="w-full rounded-sm border border-border bg-bg-deep px-2 py-1 text-xs outline-none"
          value={project.audio.channels}
          onChange={() => {}}
        >
          <option value={1}>Mono</option>
          <option value={2}>Stereo</option>
        </select>
      </Field>

      <div className="mt-4">
        <SectionTitle>默认导出设置</SectionTitle>
      </div>
      <Field label="音频格式">
        <span className="font-mono text-fg-muted">WAV</span>
      </Field>
      <Field label="字幕格式">
        <span className="font-mono text-fg-muted">SRT</span>
      </Field>

      <div className="mt-4">
        <SectionTitle>路径信息</SectionTitle>
      </div>
      <Field label="Segments 文件">
        <span className="font-mono text-2xs text-fg-muted">{project.paths.segmentsFile}</span>
      </Field>
      <Field label="音频目录">
        <span className="font-mono text-2xs text-fg-muted">{project.paths.audiosDir}</span>
      </Field>
    </div>
  )
}
