import { shell } from 'electron'
import log from 'electron-log/main'

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
 */

let initialized = false

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
      // 捕获后落盘，不 rethrow，交 electron-log 处理
      log.error('[uncaught]', error)
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
