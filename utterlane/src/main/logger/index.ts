import { BrowserWindow, shell } from 'electron'
import log from 'electron-log/main'
import type { CrashInfo } from '@shared/crash'
import { APP_IPC } from '@shared/ipc'

/** Renderer 端订阅的崩溃事件通道名 */
export const CRASH_EVENT = APP_IPC.crash

/**
 * 日志系统：基于 electron-log。
 *
 * 为什么用 electron-log 而不是手写：
 *   - 文件分卷 / 轮转开箱即用（默认 1MB × 多份）
 *   - 自动捕获 uncaughtException / unhandledRejection
 *   - 提供 renderer → main 的透明转发（在 renderer 侧 import 'electron-log/renderer'
 *     就能把 console.* 走到主进程文件里）
 *   - 体积小（几 KB），无复杂依赖
 *
 * 日志落盘位置（平台相关）：
 *   - Windows: %USERPROFILE%/AppData/Roaming/<appName>/logs/main.log
 *   - macOS:   ~/Library/Logs/<appName>/main.log
 *   - Linux:   ~/.config/<appName>/logs/main.log
 *
 * === 与 crash 广播解耦 ===
 *
 * 旧实现把 broadcastCrash 直接挂在 logger.errorHandler.onError 里——logger
 * 是基础设施，引用 BrowserWindow / CRASH_EVENT 让它跨层依赖了「app 整体
 * 行为」。改成订阅模式：logger 只负责落盘 + 通过 onUncaughtError(callback)
 * 把错误事件向外发布；上层（main/index.ts）注册一个 listener，自己决定
 * 怎么 broadcastCrash。这样 logger 就回到「写日志」的单一职责
 */

let initialized = false

type UncaughtListener = (error: Error) => void
const uncaughtListeners = new Set<UncaughtListener>()

/**
 * 订阅未捕获异常 / Promise 拒绝事件。logger 已经落盘，这里只是把事件
 * 转发给关心的上层模块（典型用途：广播给 renderer 弹 CrashDialog）。
 * 返回 unsubscribe。
 */
export function onUncaughtError(listener: UncaughtListener): () => void {
  uncaughtListeners.add(listener)
  return () => uncaughtListeners.delete(listener)
}

export function initLogger(): void {
  if (initialized) return
  initialized = true

  // 让 renderer 端 import 'electron-log/renderer' 后能自动走 IPC 回来
  log.initialize()

  // 生产里开 info，开发里开 debug
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'production' ? 'warn' : 'debug'

  // 格式：[时间戳] [级别] [来源] 内容
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] [{processType}] {text}'

  // 文件大小超 2MB 轮转，保留 3 个历史文件——
  // 对于用户偶发反馈问题，3 份日志通常覆盖够看
  log.transports.file.maxSize = 2 * 1024 * 1024

  // 自动捕获未处理异常 / promise 拒绝，不会让应用闪退无日志
  log.errorHandler.startCatching({
    showDialog: false,
    onError: ({ error }) => {
      // 落盘
      log.error('[uncaught]', error)
      // 通知订阅者，吞掉单个 listener 的异常避免连锁——本来就是 last-resort
      for (const listener of uncaughtListeners) {
        try {
          listener(error)
        } catch (err) {
          log.warn('[uncaught-listener] failed:', err)
        }
      }
    }
  })

  log.info('[logger] initialized, log file:', log.transports.file.getFile().path)
}

/**
 * 获取当前日志文件所在目录。
 * Help → Open Logs 菜单用这个返回值直接 openPath。
 */
export function getLogsFolder(): string {
  // .getFile() 返回当前日志文件对象；拿它的 path 再取父目录
  const filePath = log.transports.file.getFile().path
  // 跨平台地取父目录：倒数第一段是文件名，去掉就是目录
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSep >= 0 ? filePath.slice(0, lastSep) : filePath
}

/**
 * 让系统文件管理器打开日志目录。
 * 失败时返回错误信息；成功时返回 null（shell.openPath 的约定：空字符串 = 成功）。
 */
export async function openLogsFolder(): Promise<string | null> {
  const folder = getLogsFolder()
  const err = await shell.openPath(folder)
  return err || null
}

export { log as logger }

/**
 * 广播崩溃信息到所有窗口。
 *
 * 分两类调用方：
 *   - 内部：errorHandler.onError 捕获到 main 异常时调
 *   - 外部 IPC：renderer 也可能直接调（renderer 自己的 window.onerror 走本地 dispatch
 *     就行，不需要绕回 main 再回来；这个 export 主要给未来可能的「让 main 主动通报
 *     某个错误」预留接口）
 *
 * 失败时静默吞掉——本来就是 last-resort 路径，不能再抛出造成连锁反应。
 */
export function broadcastCrash(info: CrashInfo): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(CRASH_EVENT, info)
      }
    }
  } catch (err) {
    log.warn('[crash-broadcast] failed:', err)
  }
}
