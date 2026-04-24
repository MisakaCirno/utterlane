import { FolderOpen, FileText, Mic, Clock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { cn } from '@renderer/lib/cn'
import { newProject, openProject, openProjectPath } from '@renderer/actions/project'

/**
 * 无活动工程时显示的欢迎页。
 *
 * 触发条件（和 docs/utterlane.md#欢迎页 一致）：
 *   - 首次启动
 *   - 最近工程路径失效
 *   - 用户主动关闭当前工程
 */
export function WelcomeView(): React.JSX.Element {
  const { t } = useTranslation()
  const recentProjects = usePreferencesStore((s) => s.prefs.recentProjects ?? [])
  const updatePrefs = usePreferencesStore((s) => s.update)

  const removeRecent = (path: string): void => {
    updatePrefs({ recentProjects: recentProjects.filter((p) => p !== path) })
  }

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-bg">
      <div className="flex w-full max-w-3xl gap-10 px-10 py-12">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-fg">
            <Mic size={22} className="text-accent" />
            <span className="text-lg font-semibold tracking-wide">{t('app.title')}</span>
          </div>
          <div className="text-xs text-fg-muted">{t('app.tagline')}</div>
          <div className="mt-6 flex flex-col gap-2">
            <WelcomeAction
              icon={<FileText size={14} />}
              label={t('welcome.new_project')}
              hint={t('welcome.new_project_hint')}
              onClick={newProject}
            />
            <WelcomeAction
              icon={<FolderOpen size={14} />}
              label={t('welcome.open_project')}
              hint={t('welcome.open_project_hint')}
              onClick={openProject}
            />
          </div>
        </div>

        <div className="h-auto w-px shrink-0 bg-border" />

        <div className="flex-1">
          <div className="flex items-center gap-2 pb-2 text-2xs uppercase tracking-wider text-fg-dim">
            <Clock size={11} />
            {t('welcome.recent_projects')}
          </div>
          {recentProjects.length === 0 ? (
            <div className="py-6 text-xs text-fg-dim">{t('welcome.no_recent')}</div>
          ) : (
            <ul className="flex flex-col">
              {recentProjects.map((path) => (
                <RecentProjectItem key={path} path={path} onRemove={() => removeRecent(path)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function WelcomeAction({
  icon,
  label,
  hint,
  onClick
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-sm border border-border bg-bg-panel px-3 py-2 text-left',
        'hover:border-accent hover:bg-bg-raised'
      )}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-bg-raised text-fg-muted">
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-xs text-fg">{label}</span>
        <span className="text-2xs text-fg-dim">{hint}</span>
      </span>
    </button>
  )
}

function RecentProjectItem({
  path,
  onRemove
}: {
  path: string
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  // 从绝对路径中拆出目录名作为主标题，完整路径作为副标题
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  return (
    <li className="group flex items-center">
      <button
        onClick={() => openProjectPath(path)}
        className={cn(
          'flex flex-1 flex-col items-start gap-0.5 rounded-sm px-2 py-1.5',
          'hover:bg-bg-raised'
        )}
      >
        <span className="text-xs text-fg">{name}</span>
        <span className="max-w-full truncate text-2xs text-fg-dim" title={path}>
          {path}
        </span>
      </button>
      <button
        onClick={onRemove}
        className={cn(
          'ml-1 rounded-sm p-1 text-fg-dim opacity-0 transition-opacity',
          'hover:bg-bg-raised hover:text-rec group-hover:opacity-100'
        )}
        title={t('welcome.remove_recent')}
        aria-label={t('welcome.remove_recent')}
      >
        <X size={11} />
      </button>
    </li>
  )
}
