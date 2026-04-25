import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { preferencesStore, registerPreferencesIpc } from './preferences'
import { projectSession, registerProjectIpc } from './project-storage'
import { registerRecordingIpc } from './recording'
import { registerExportIpc } from './export'
import { registerAudioAuditIpc } from './audio-audit'
import { initLogger } from './logger'
import { registerLogsIpc } from './logger/ipc'
import { registerAppInfoIpc } from './app-info/ipc'
import type { WindowBounds } from '@shared/preferences'

// 日志必须最早 init：后面任何模块的 log 调用、uncaughtException 捕获都依赖它
initLogger()

/** 窗口尺寸下限：低于此值 UI 会严重挤压，拒绝接受更小的持久化值 */
const MIN_WINDOW_WIDTH = 900
const MIN_WINDOW_HEIGHT = 600

/** 默认窗口尺寸（首次启动或偏好文件中没有 window bounds 时使用） */
const DEFAULT_WINDOW_WIDTH = 1280
const DEFAULT_WINDOW_HEIGHT = 800

/**
 * 把持久化的 window bounds 合并到 BrowserWindow 构造参数。
 * 位置信息（x/y）只有两个值都存在时才应用，避免单独一个字段导致窗口跳到奇怪位置。
 */
function resolveInitialBounds(saved: WindowBounds | undefined): {
  width: number
  height: number
  x?: number
  y?: number
} {
  const width = Math.max(MIN_WINDOW_WIDTH, saved?.width ?? DEFAULT_WINDOW_WIDTH)
  const height = Math.max(MIN_WINDOW_HEIGHT, saved?.height ?? DEFAULT_WINDOW_HEIGHT)
  const hasPosition = saved?.x !== undefined && saved?.y !== undefined
  return hasPosition ? { width, height, x: saved.x, y: saved.y } : { width, height }
}

/**
 * 关窗流程：
 *   1. 用户触发关窗（标题栏 X / Alt+F4 / OS 关闭）
 *   2. 首次 close 事件：main 拦截 + preventDefault，向 renderer 发 `window:close-request`
 *   3. renderer 查看保存状态：已保存直接同意；未保存弹确认框
 *   4. renderer 回 `window:close-confirmed` → main 置位 allowClose 后再次调 close()
 *   5. 第二次 close 事件看到 allowClose=true，放行
 *
 * allowClose 由 BrowserWindow 实例的 Symbol 属性挂载；这样多窗口场景各自独立。
 */
const ALLOW_CLOSE_KEY = Symbol('utterlane.allowClose')
type WindowWithAllowClose = BrowserWindow & { [ALLOW_CLOSE_KEY]?: boolean }

function createWindow(): void {
  const prefs = preferencesStore.snapshot
  const bounds = resolveInitialBounds(prefs.window)

  const mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    backgroundColor: '#1e1e1e',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  }) as WindowWithAllowClose

  mainWindow.on('close', (event) => {
    if (mainWindow[ALLOW_CLOSE_KEY]) return
    event.preventDefault()
    mainWindow.webContents.send('window:close-request')
  })

  // 上次退出时若是最大化状态，新窗口打开后恢复最大化
  if (prefs.window?.maximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  const emitMaximizeState = (): void => {
    mainWindow.webContents.send('window:maximize-state', mainWindow.isMaximized())
  }
  mainWindow.on('maximize', () => {
    emitMaximizeState()
    preferencesStore.update({ window: { ...mainWindow.getBounds(), maximized: true } })
  })
  mainWindow.on('unmaximize', () => {
    emitMaximizeState()
    preferencesStore.update({ window: { ...mainWindow.getBounds(), maximized: false } })
  })

  // resize / move 会高频触发，preferencesStore 自带 debounce 不用再限流。
  // 最大化时的 bounds 是屏幕全尺寸，把它落盘会污染下次非最大化时的默认大小，
  // 所以这里只在非最大化状态下保存 bounds。
  const persistBounds = (): void => {
    if (mainWindow.isMaximized()) return
    preferencesStore.update({ window: { ...mainWindow.getBounds(), maximized: false } })
  }
  mainWindow.on('resize', persistBounds)
  mainWindow.on('move', persistBounds)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.utterlane')

  // 在创建窗口前加载偏好：窗口大小、位置、最大化状态都依赖它
  await preferencesStore.init()
  registerPreferencesIpc()
  registerProjectIpc()
  registerRecordingIpc()
  registerExportIpc()
  registerAudioAuditIpc()
  registerLogsIpc()
  registerAppInfoIpc()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.on('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  // renderer 确认后主动调这个 IPC：置 allowClose 后第二次 close 就会放行
  ipcMain.on('window:close-confirmed', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) as WindowWithAllowClose | null
    if (!win) return
    win[ALLOW_CLOSE_KEY] = true
    win.close()
  })
  ipcMain.handle('window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 退出前把 pending 的偏好 + workspace 变更刷盘，
// 并按规范释放工程锁（避免下次启动被自己的僵尸锁挡住）。
// before-quit 可能多次触发（每个窗口关闭一次），用一个 flag 防止重入。
let isFlushingOnQuit = false
app.on('before-quit', async (event) => {
  if (isFlushingOnQuit) return
  event.preventDefault()
  isFlushingOnQuit = true
  await projectSession.close()
  await preferencesStore.flush()
  // app.exit() 是硬退出，不会再触发 before-quit，所以不会循环
  app.exit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
