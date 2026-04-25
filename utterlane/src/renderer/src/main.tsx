import './assets/main.css'
// i18n 必须在任何组件使用 useTranslation 之前初始化
import './i18n'
// electron-log/renderer 会替换 console.log/warn/error，转发到 main 的日志文件
// 同时也把本窗口内未捕获的 error / promise rejection 送回 main
import 'electron-log/renderer'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { reportCrash } from './store/crashStore'

/**
 * 把 renderer 端各种未捕获错误统一送进 crashStore 弹窗。
 *
 * 三个来源：
 *   1. window error 事件：常见 JS 运行时错误（语法 / 引用 / 类型等）
 *   2. unhandledrejection：未 catch 的 Promise reject
 *   3. React 19 onUncaughtError：组件渲染期间抛出的、ErrorBoundary 没接住的错误
 *
 * 三者都汇成同一份 CrashInfo 走 reportCrash，对 UI 来说统一展示。
 */
window.addEventListener('error', (e) => {
  reportCrash({
    source: 'renderer',
    title: e.error?.name || 'Error',
    message: e.error?.message || e.message || 'Unknown error',
    stack: e.error?.stack,
    timestamp: new Date().toISOString()
  })
})

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  const isError = reason instanceof Error
  reportCrash({
    source: 'renderer',
    title: isError ? reason.name : 'UnhandledRejection',
    message: isError ? reason.message : String(reason),
    stack: isError ? reason.stack : undefined,
    timestamp: new Date().toISOString()
  })
})

createRoot(document.getElementById('root')!, {
  // React 19：组件渲染期未被 ErrorBoundary 接住的错误走这里。
  // error 类型是 unknown（按规范任何东西都能 throw），统一兜成 Error
  onUncaughtError: (error) => {
    const err = error instanceof Error ? error : new Error(String(error))
    reportCrash({
      source: 'renderer',
      title: err.name || 'React Error',
      message: err.message || 'Unknown render error',
      stack: err.stack,
      timestamp: new Date().toISOString()
    })
  }
}).render(
  <StrictMode>
    <App />
  </StrictMode>
)
