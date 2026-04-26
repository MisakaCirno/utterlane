/**
 * 编辑器配色（编辑器 = 整个工作区，不仅是文本编辑）。
 *
 * 维护 16 个语义色 token，覆盖所有 UI 表面（背景层 / 文字层 / 边框 /
 * 强调色 / 录音 / 成功）。每个 token 对应 :root 的一个 --c-* CSS 变量，
 * Tailwind 通过 rgb(var(--c-*) / <alpha-value>) 引用——保留 / 透明度
 * 修饰符 + 主题切换 + 用户自定义 overrides 三件事同时支持。
 *
 * 主题切换 / 自定义在 renderer 写入 :root.style.setProperty；shared 不
 * 持任何运行时依赖，主进程 / preload / 测试都可以安全 import 这份调色
 * 板做参考
 */

export const COLOR_TOKENS = [
  'bg',
  'bg.deep',
  'bg.panel',
  'bg.raised',
  'chrome',
  'chrome.hover',
  'border',
  'border.strong',
  'border.subtle',
  'fg',
  'fg.muted',
  'fg.dim',
  'accent',
  'accent.soft',
  'rec',
  'ok'
] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]

/**
 * 调色板：每个 token 一个 #rrggbb 字符串。preset 与 overrides 都用这
 * 个形状，方便互相 spread 合并
 */
export type ThemePalette = Record<ColorToken, string>

/** Tailwind class 用的 token → CSS 变量后缀映射（'bg.deep' → 'bg-deep'） */
export function tokenToCssVar(token: ColorToken): string {
  return token.replace('.', '-')
}

/** 把 #rrggbb 转 'R G B' 三元组字符串供 rgb(... / alpha) 使用。非法值回落到 0 0 0 */
export function hexToRgbTriple(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '0 0 0'
  const v = parseInt(m[1], 16)
  return `${(v >> 16) & 0xff} ${(v >> 8) & 0xff} ${v & 0xff}`
}

// ---------------------------------------------------------------------------
// 内置预设
// ---------------------------------------------------------------------------

/**
 * 默认 Dark：对齐 dockview Dark 主题 + VSCode Dark+ 调色板。这是 app
 * 历史 baseline，老用户的默认体验
 */
export const PRESET_DARK: ThemePalette = {
  bg: '#1e1e1e',
  'bg.deep': '#181818',
  'bg.panel': '#252526',
  'bg.raised': '#2d2d2d',
  chrome: '#3c3c3c',
  'chrome.hover': '#4a4a4a',
  border: '#444444',
  'border.strong': '#525252',
  'border.subtle': '#2d2d2d',
  fg: '#cccccc',
  'fg.muted': '#9a9a9a',
  'fg.dim': '#6a6a6a',
  accent: '#0e639c',
  'accent.soft': '#094771',
  rec: '#d14545',
  ok: '#73c991'
}

/** 浅色：浅灰 / 白底 + 蓝色强调，对比度足够日常使用 */
export const PRESET_LIGHT: ThemePalette = {
  bg: '#ffffff',
  'bg.deep': '#f3f3f3',
  'bg.panel': '#f8f8f8',
  'bg.raised': '#ececec',
  chrome: '#dddddd',
  'chrome.hover': '#cfcfcf',
  border: '#cccccc',
  'border.strong': '#aaaaaa',
  'border.subtle': '#e5e5e5',
  fg: '#1f1f1f',
  'fg.muted': '#555555',
  'fg.dim': '#888888',
  accent: '#005a9e',
  'accent.soft': '#cce4f7',
  rec: '#c43e3e',
  ok: '#3fa55a'
}

/**
 * 高对比度：黑底 + 极亮文字 + 强烈强调色，便于视障 / 低视力用户。
 * 故意把 border 提到亮白让区块边界一目了然
 */
export const PRESET_HIGH_CONTRAST: ThemePalette = {
  bg: '#000000',
  'bg.deep': '#000000',
  'bg.panel': '#0a0a0a',
  'bg.raised': '#1a1a1a',
  chrome: '#000000',
  'chrome.hover': '#262626',
  border: '#ffffff',
  'border.strong': '#ffffff',
  'border.subtle': '#444444',
  fg: '#ffffff',
  'fg.muted': '#dddddd',
  'fg.dim': '#bbbbbb',
  accent: '#1aebff',
  'accent.soft': '#003940',
  rec: '#ff5050',
  ok: '#5dff8d'
}

export const THEME_PRESET_KEYS = ['dark', 'light', 'highContrast'] as const
export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number]

export const THEME_PRESETS: Record<ThemePresetKey, ThemePalette> = {
  dark: PRESET_DARK,
  light: PRESET_LIGHT,
  highContrast: PRESET_HIGH_CONTRAST
}

/**
 * 解析最终生效的调色板：preset 是底色，overrides 逐 token 覆盖。
 * preset 缺失 / 不识别时回退 dark；overrides 里非 16 个 token 的字段会
 * 被忽略（防止旧偏好里的 stale 字段污染当前 palette）
 */
export function resolvePalette(
  preset: ThemePresetKey | undefined,
  overrides: Partial<ThemePalette> | undefined
): ThemePalette {
  const base = THEME_PRESETS[preset ?? 'dark'] ?? THEME_PRESETS.dark
  if (!overrides) return base
  const out: ThemePalette = { ...base }
  for (const token of COLOR_TOKENS) {
    const v = overrides[token]
    if (typeof v === 'string' && /^#?[0-9a-f]{6}$/i.test(v.trim())) {
      out[token] = v.startsWith('#') ? v : `#${v}`
    }
  }
  return out
}
