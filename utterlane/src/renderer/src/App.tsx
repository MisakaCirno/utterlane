import { useEffect } from 'react'
import { Titlebar } from './shell/Titlebar'
import { StatusBar } from './shell/StatusBar'
import { Workspace } from './shell/Workspace'
import { WelcomeView } from './views/WelcomeView'
import { useEditorStore } from './store/editorStore'
import { connectPreferencesStore, usePreferencesStore } from './store/preferencesStore'

function App(): React.JSX.Element {
  const hasProject = useEditorStore((s) => s.project !== null)
  const hydrated = usePreferencesStore((s) => s.hydrated)

  // 启动时拉取一次 preferences 并订阅后续变更。
  // 订阅 cleanup 返回给 useEffect 以便在开发热重载时不会遗留监听器。
  useEffect(() => {
    let cleanup: (() => void) | undefined
    connectPreferencesStore().then((unsubscribe) => {
      cleanup = unsubscribe
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
