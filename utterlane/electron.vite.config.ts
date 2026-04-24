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
    plugins: [react()]
  }
})
