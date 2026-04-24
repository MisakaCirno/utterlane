import {
  themeAbyss,
  themeAbyssSpaced,
  themeDark,
  themeDracula,
  themeLight,
  themeLightSpaced,
  themeReplit,
  themeVisualStudio,
  type DockviewTheme
} from 'dockview-react'
import type { DockThemeKey } from '@shared/preferences'

/**
 * 全部可选的 dock 主题。key 是持久化到 preferences.json 的字符串，
 * theme 是 dockview 实际使用的 DockviewTheme 对象。
 *
 * 新增主题时同时维护 DockThemeKey union（@shared/preferences）。
 */
export const themeRegistry: Array<{ key: DockThemeKey; label: string; theme: DockviewTheme }> = [
  { key: 'dark', label: 'Dark (默认)', theme: themeDark },
  { key: 'light', label: 'Light', theme: themeLight },
  { key: 'visualStudio', label: 'Visual Studio', theme: themeVisualStudio },
  { key: 'abyss', label: 'Abyss', theme: themeAbyss },
  { key: 'abyssSpaced', label: 'Abyss Spaced', theme: themeAbyssSpaced },
  { key: 'dracula', label: 'Dracula', theme: themeDracula },
  { key: 'replit', label: 'Replit', theme: themeReplit },
  { key: 'lightSpaced', label: 'Light Spaced', theme: themeLightSpaced }
]

export function getThemeByKey(key: DockThemeKey): DockviewTheme {
  return themeRegistry.find((t) => t.key === key)?.theme ?? themeDark
}
