import { FolderOpen, FileText, Mic, Clock } from 'lucide-react'
import { useEditorStore } from '@renderer/store/editorStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { cn } from '@renderer/lib/cn'

/**
 * 无活动工程时显示的欢迎页。
 *
 * 触发条件（和 docs/utterlane.md#欢迎页 一致）：
 *   - 首次启动
 *   - 最近工程路径失效
 *   - 用户主动关闭当前工程
 *
 * 本页只承担「进入工程」的入口职责，不做编辑。
 * 打开 / 新建工程按钮当前是 stub —— Slice B 接入真实的文件对话框与加载流程后替换。
 */
export function WelcomeView(): React.JSX.Element {
  const openMockProject = useEditorStore((s) => s.openMockProject)
  const recentProjects = usePreferencesStore((s) => s.prefs.recentProjects ?? [])

  return (
    <div className="flex flex-1 items-center justify-center overflow-auto bg-bg">
      <div className="flex w-full max-w-3xl gap-10 px-10 py-12">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-fg">
            <Mic size={22} className="text-accent" />
            <span className="text-lg font-semibold tracking-wide">Utterlane</span>
          </div>
          <div className="text-xs text-fg-muted">口播录音工作流</div>
          <div className="mt-6 flex flex-col gap-2">
            <WelcomeAction
              icon={<FileText size={14} />}
              label="新建工程"
              hint="从一段文案开始"
              onClick={() => {
                // TODO (Slice B): 弹出新建工程对话框并创建 project.json
                openMockProject()
              }}
            />
            <WelcomeAction
              icon={<FolderOpen size={14} />}
              label="打开工程"
              hint="选择现有工程目录"
              onClick={() => {
                // TODO (Slice B): 走系统目录选择 + 校验 project.json
                openMockProject()
              }}
            />
          </div>
        </div>

        <div className="h-auto w-px shrink-0 bg-border" />

        <div className="flex-1">
          <div className="flex items-center gap-2 pb-2 text-2xs uppercase tracking-wider text-fg-dim">
            <Clock size={11} />
            最近工程
          </div>
          {recentProjects.length === 0 ? (
            <div className="py-6 text-xs text-fg-dim">还没有最近工程</div>
          ) : (
            <ul className="flex flex-col">
              {recentProjects.map((path) => (
                <RecentProjectItem key={path} path={path} />
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

function RecentProjectItem({ path }: { path: string }): React.JSX.Element {
  // 从绝对路径中拆出目录名作为主标题，完整路径作为副标题
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path
  return (
    <li>
      <button
        onClick={() => {
          // TODO (Slice B): 校验路径是否仍然有效，有效则加载，失效则提示并允许移除
        }}
        className={cn(
          'flex w-full flex-col items-start gap-0.5 rounded-sm px-2 py-1.5',
          'hover:bg-bg-raised'
        )}
      >
        <span className="text-xs text-fg">{name}</span>
        <span className="truncate text-2xs text-fg-dim" title={path}>
          {path}
        </span>
      </button>
    </li>
  )
}
