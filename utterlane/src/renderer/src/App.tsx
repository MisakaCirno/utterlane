import { useEffect } from 'react'
import { Titlebar } from './shell/Titlebar'
import { StatusBar } from './shell/StatusBar'
import { Workspace } from './shell/Workspace'
import { WelcomeView } from './views/WelcomeView'
import { useEditorStore } from './store/editorStore'
import { connectPreferencesStore, usePreferencesStore } from './store/preferencesStore'
import { openProjectPath } from './actions/project'

function App(): React.JSX.Element {
  const hasProject = useEditorStore((s) => s.project !== null)
  const hydrated = usePreferencesStore((s) => s.hydrated)

  // 启动时：
  //   1. 拉取偏好并订阅变更
  //   2. 询问 main 是否已有正在打开的工程（进程内热重载 / 窗口重建时会命中）
  //
  // 常规冷启动 main 侧 projectSession 还是空，会回落到欢迎页。
  // 未来如果实现「启动时自动打开上次工程」，把那个逻辑放到 main 侧 session.init()，
  // renderer 这里不需要改动——现成的 getCurrent 会拿到 path，然后 openProjectPath 会加载。
  useEffect(() => {
    let cleanup: (() => void) | undefined
    connectPreferencesStore().then((unsubscribe) => {
      cleanup = unsubscribe
    })

    window.api.project.getCurrent().then((path) => {
      if (path) void openProjectPath(path)
    })

    return () => cleanup?.()
  }, [])

  // 首帧若 preferences 尚未 hydrate，整个 body 空白留给默认背景色（避免主题闪烁）。
  // Titlebar 与 StatusBar 始终渲染，保持窗口 chrome 稳定。
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Titlebar />
      {!hydrated ? <div className="flex-1 bg-bg" /> : hasProject ? <Workspace /> : <WelcomeView />}
      <StatusBar />
    </div>
  )
}

export default App
