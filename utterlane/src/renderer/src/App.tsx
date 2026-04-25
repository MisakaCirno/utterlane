import { useEffect } from 'react'
import i18nInstance from './i18n'
import { Titlebar } from './shell/Titlebar'
import { StatusBar } from './shell/StatusBar'
import { Workspace } from './shell/Workspace'
import { ToastHost } from './shell/ToastHost'
import { ConfirmHost } from './shell/ConfirmHost'
import { CountdownOverlay } from './shell/CountdownOverlay'
import { WelcomeView } from './views/WelcomeView'
import { ImportScriptDialog } from './dialogs/ImportScriptDialog'
import { PreferencesDialog } from './dialogs/PreferencesDialog'
import { AboutDialog } from './dialogs/AboutDialog'
import { CrashDialog } from './dialogs/CrashDialog'
import { ExportDialog } from './dialogs/ExportDialog'
import { AudioAuditDialog } from './dialogs/AudioAuditDialog'
import { reportCrash } from './store/crashStore'
import { useEditorStore } from './store/editorStore'
import { connectPreferencesStore, usePreferencesStore } from './store/preferencesStore'
import { useDialogStore } from './store/dialogStore'
import { confirm } from './store/confirmStore'
import { openProjectPath } from './actions/project'
import { installKeyboardShortcuts } from './shell/keyboardShortcuts'

function App(): React.JSX.Element {
  const hasProject = useEditorStore((s) => s.project !== null)
  const hydrated = usePreferencesStore((s) => s.hydrated)
  const locale = usePreferencesStore((s) => s.prefs.appearance?.locale)
  const fontScale = usePreferencesStore((s) => s.prefs.appearance?.fontScale)
  const importScriptOpen = useDialogStore((s) => s.importScriptOpen)
  const closeImportScript = useDialogStore((s) => s.closeImportScript)
  const preferencesOpen = useDialogStore((s) => s.preferencesOpen)
  const closePreferences = useDialogStore((s) => s.closePreferences)
  const aboutOpen = useDialogStore((s) => s.aboutOpen)
  const closeAbout = useDialogStore((s) => s.closeAbout)
  const exportAudioOpen = useDialogStore((s) => s.exportAudioOpen)
  const closeExportAudio = useDialogStore((s) => s.closeExportAudio)
  const audioAuditOpen = useDialogStore((s) => s.audioAuditOpen)
  const closeAudioAudit = useDialogStore((s) => s.closeAudioAudit)

  // 跟随 preferences 切换 UI 语言。hydrate 后至少触发一次确保和存储值一致。
  useEffect(() => {
    if (locale && i18nInstance.language !== locale) {
      void i18nInstance.changeLanguage(locale)
    }
  }, [locale])

  // 字体缩放：把 fontScale 写到 documentElement 的 --fs-scale 变量上，
  // 所有 text-* Tailwind 类会通过 CSS 变量自动跟随。
  // 范围收紧到 0.8~1.5，避免用户误操作造成 UI 崩溃。
  useEffect(() => {
    const clamped = Math.max(0.8, Math.min(1.5, fontScale ?? 1))
    document.documentElement.style.setProperty('--fs-scale', String(clamped))
  }, [fontScale])

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
          title: i18nInstance.t('confirm.close_recording_title'),
          description: i18nInstance.t('confirm.close_recording_description'),
          confirmLabel: i18nInstance.t('confirm.close_recording_btn'),
          tone: 'danger'
        })
        if (!ok) return
      } else if (!saved) {
        const ok = await confirm({
          title: i18nInstance.t('confirm.close_unsaved_title'),
          confirmLabel: i18nInstance.t('confirm.close_unsaved_btn'),
          tone: 'danger'
        })
        if (!ok) return
      }
      window.api.window.confirmClose()
    })

    const shortcutsCleanup = installKeyboardShortcuts()

    // 订阅 main 端的崩溃事件 → 走和 renderer 自身错误同样的弹窗
    const crashCleanup = window.api.app.onCrash((info) => {
      reportCrash(info)
    })

    return () => {
      cleanup?.()
      closeCleanup()
      shortcutsCleanup()
      crashCleanup()
    }
  }, [])

  // 首帧若 preferences 尚未 hydrate，整个 body 空白留给默认背景色（避免主题闪烁）。
  // Titlebar 与 StatusBar 始终渲染，保持窗口 chrome 稳定。
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <Titlebar />
      {!hydrated ? <div className="flex-1 bg-bg" /> : hasProject ? <Workspace /> : <WelcomeView />}
      {/*
        主内容与状态栏之间留 4px 深色带做视觉分隔——
        不加的话 dockview panel 底部的滚动条 thumb（灰色）会和状态栏背景（灰色）
        粘在一起。用 bg-bg-deep 是整套调色板里最深的灰，对比最明显。
      */}
      <div className="h-1 shrink-0 bg-bg-deep" />
      <StatusBar />
      <ImportScriptDialog
        open={importScriptOpen}
        onOpenChange={(open) => !open && closeImportScript()}
      />
      <PreferencesDialog
        open={preferencesOpen}
        onOpenChange={(open) => !open && closePreferences()}
      />
      <AboutDialog open={aboutOpen} onOpenChange={(open) => !open && closeAbout()} />
      <ExportDialog open={exportAudioOpen} onOpenChange={(open) => !open && closeExportAudio()} />
      <AudioAuditDialog open={audioAuditOpen} onOpenChange={(open) => !open && closeAudioAudit()} />
      <CrashDialog />
      <ConfirmHost />
      <ToastHost />
      <CountdownOverlay />
    </div>
  )
}

export default App
