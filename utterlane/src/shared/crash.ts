/**
 * 崩溃 / 未处理异常的展示用结构。
 *
 * 不论错误来自 main 还是 renderer，最终都汇成这一个 shape，
 * 由 CrashDialog 用同一套 UI 呈现。
 */
export type CrashInfo = {
  /** 错误来自哪一层。用户看了知道是软件崩了还是窗口崩了 */
  source: 'main' | 'renderer'
  /** 短标题（一般是 Error 名 / 'UnhandledRejection' / 'Uncaught'） */
  title: string
  /** 单行错误消息 */
  message: string
  /** 堆栈，可选 */
  stack?: string
  /** ISO 时间戳，方便用户在反馈时附上时间点 */
  timestamp: string
}
