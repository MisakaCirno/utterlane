import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// `@shared` 命中 src/shared，同时在 main / preload / renderer 三层使用。
// 用来放跨进程共享的纯类型 / 常量 / 纯函数（不能依赖 DOM 或 Electron API）。
const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: {
      alias: sharedAlias
    }
  },
  preload: {
    resolve: {
      alias: sharedAlias
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        ...sharedAlias
      }
    },
    plugins: [react()],
    build: {
      // Vite 默认对 < 4KB 的 ?url 资源会 inline 成 data:text/javascript;base64
      // URL。这对录音用的 AudioWorklet 文件是致命的——CSP 的 script-src
      // 'self' 不允许 data: 协议加载脚本，prod 构建会被浏览器拦截。
      //
      // 把 inline 阈值降到 0：所有 ?url 资源 emit 为独立文件，URL 走 'self'
      // 同源。本项目目前唯一的 ?url 用法就是 worklet，全局禁用 inline 没
      // 副作用；若将来加图片等小资源，按需在导入处用 ?url&inline 显式覆盖
      assetsInlineLimit: 0
    }
  }
})
