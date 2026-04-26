/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 所有色值都走 CSS 变量 + rgb(... / <alpha-value>)：
        //   - 主题切换 / 用户自定义 overrides 只需要写一次 :root.style
        //     setProperty 就全 UI 生效（见 App.tsx 的 useEffect）
        //   - <alpha-value> 占位让 bg-accent/40 这类 alpha 修饰符仍然
        //     有效；rgb 函数语法 + 三元组（'R G B'）字符串变量是
        //     Tailwind 推荐的搭配
        // 默认值定义在 main.css :root 里，保证未 hydrate 时的首帧不空白
        bg: {
          DEFAULT: 'rgb(var(--c-bg) / <alpha-value>)',
          deep: 'rgb(var(--c-bg-deep) / <alpha-value>)',
          panel: 'rgb(var(--c-bg-panel) / <alpha-value>)',
          raised: 'rgb(var(--c-bg-raised) / <alpha-value>)'
        },
        chrome: {
          DEFAULT: 'rgb(var(--c-chrome) / <alpha-value>)',
          hover: 'rgb(var(--c-chrome-hover) / <alpha-value>)'
        },
        border: {
          DEFAULT: 'rgb(var(--c-border) / <alpha-value>)',
          strong: 'rgb(var(--c-border-strong) / <alpha-value>)',
          subtle: 'rgb(var(--c-border-subtle) / <alpha-value>)'
        },
        fg: {
          DEFAULT: 'rgb(var(--c-fg) / <alpha-value>)',
          muted: 'rgb(var(--c-fg-muted) / <alpha-value>)',
          dim: 'rgb(var(--c-fg-dim) / <alpha-value>)'
        },
        accent: {
          DEFAULT: 'rgb(var(--c-accent) / <alpha-value>)',
          soft: 'rgb(var(--c-accent-soft) / <alpha-value>)'
        },
        rec: 'rgb(var(--c-rec) / <alpha-value>)',
        ok: 'rgb(var(--c-ok) / <alpha-value>)'
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
