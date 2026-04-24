import './assets/main.css'
// i18n 必须在任何组件使用 useTranslation 之前初始化
import './i18n'
// electron-log/renderer 会替换 console.log/warn/error，转发到 main 的日志文件
// 同时也把本窗口内未捕获的 error / promise rejection 送回 main
import 'electron-log/renderer'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
