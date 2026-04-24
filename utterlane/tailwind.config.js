/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 对齐 dockview Dark 主题 + VSCode Dark+ 调色板
        bg: {
          DEFAULT: '#1e1e1e', // editor / group view
          deep: '#181818', // 最深层（input、深凹区）
          panel: '#252526', // sidebar / tab 栏
          raised: '#2d2d2d' // hidden tab / 次级面板
        },
        chrome: {
          DEFAULT: '#3c3c3c', // titlebar（VSCode 同款）
          hover: '#4a4a4a'
        },
        border: {
          DEFAULT: '#444444', // dockview separator (rgb(68,68,68))
          strong: '#525252',
          subtle: '#2d2d2d'
        },
        fg: {
          DEFAULT: '#cccccc', // VSCode 正文
          muted: '#9a9a9a',
          dim: '#6a6a6a'
        },
        accent: {
          DEFAULT: '#0e639c', // VSCode button / 主题蓝
          soft: '#094771' // list selection bg
        },
        rec: '#d14545',
        ok: '#73c991' // VSCode git added
      },
      fontFamily: {
        sans: ['Segoe UI', '-apple-system', 'BlinkMacSystemFont', 'Inter', 'sans-serif'],
        mono: ['Consolas', 'Menlo', 'Monaco', 'monospace']
      },
      // 字号全部走 CSS 变量，方便偏好里切换「字体缩放」时一次性把整 UI 拉伸。
      // 变量定义在 main.css 的 :root；scale 值由 preferences.appearance.fontScale
      // 驱动，计算在 root 的 --fs-scale。
      fontSize: {
        '2xs': ['var(--fs-2xs)', { lineHeight: 'var(--fs-2xs-lh)' }],
        xs: ['var(--fs-xs)', { lineHeight: 'var(--fs-xs-lh)' }],
        sm: ['var(--fs-sm)', { lineHeight: 'var(--fs-sm-lh)' }],
        base: ['var(--fs-base)', { lineHeight: 'var(--fs-base-lh)' }]
      }
    }
  },
  plugins: []
}
