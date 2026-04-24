import { useEffect } from 'react'
import { Titlebar } from './shell/Titlebar'
import { StatusBar } from './shell/StatusBar'
import { Workspace } from './shell/Workspace'
import { ToastHost } from './shell/ToastHost'
import { ConfirmHost } from './shell/ConfirmHost'
import { WelcomeView } from './views/WelcomeView'
import { ImportScriptDialog } from './dialogs/ImportScriptDialog'
import { useEditorStore } from './store/editorStore'
import { connectPreferencesStore, usePreferencesStore } from './store/preferencesStore'
import { useDialogStore } from './store/dialogStore'
import { confirm } from './store/confirmStore'
import { openProjectPath } from './actions/project'
import { installKeyboardShortcuts } from './shell/keyboardShortcuts'

function App(): React.JSX.Element {
  const hasProject = useEditorStore((s) => s.project !== null)
  const hydrated = usePreferencesStore((s) => s.hydrated)
  const importScriptOpen = useDialogStore((s) => s.importScriptOpen)
  const closeImportScript = useDialogStore((s) => s.closeImportScript)

  // 启动时：
  //   1. 拉取偏好并订阅变更
  //   2. 询问 main 是否已有正在打开的工程（进程内热重载 / 窗口重建时会命中）
  //   3. 订阅主进程的关窗请求，按 saved 状态决定是否二次确认
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

    // 关窗请求处理：
    //   - 录音中：拦截（用户会丢失正在录的内容）
    //   - 未保存：弹 AlertDialog 征询
    //   - 其他情况：直接 confirmClose
    const closeCleanup = window.api.window.onCloseRequest(async () => {
      const { saved, playback } = useEditorStore.getState()
      if (playback === 'recording') {
        const ok = await confirm({
          title: '正在录音，确定关闭吗？',
          description: '当前录音将被丢弃。',
          confirmLabel: '关闭并丢弃',
          tone: 'danger'
        })
        if (!ok) return
      } else if (!saved) {
        const ok = await confirm({
          title: '还有未保存的改动，确定关闭吗？',
          confirmLabel: '丢弃并关闭',
          tone: 'danger'
        })
        if (!ok) return
      }
      window.api.window.confirmClose()
    })

    const shortcutsCleanup = installKeyboardShortcuts()

    return () => {
      cleanup?.()
      closeCleanup()
      shortcutsCleanup()
    }
  }, [])

  // 首帧若 preferences 尚未 hydrate，整个 body 空白留给默认背景色（避免主题闪烁）。
  // Titlebar 与 StatusBar 始终渲染，保持窗口 chrome 稳定。
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Titlebar />
      {!hydrated ? <div className="flex-1 bg-bg" /> : hasProject ? <Workspace /> : <WelcomeView />}
      <StatusBar />
      <ImportScriptDialog
        open={importScriptOpen}
        onOpenChange={(open) => !open && closeImportScript()}
      />
      <ConfirmHost />
      <ToastHost />
    </div>
  )
}

export default App
