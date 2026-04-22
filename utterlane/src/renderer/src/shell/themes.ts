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

export type ThemeKey =
  | 'dark'
  | 'light'
  | 'visualStudio'
  | 'abyss'
  | 'abyssSpaced'
  | 'dracula'
  | 'replit'
  | 'lightSpaced'

export const themeRegistry: Array<{ key: ThemeKey; label: string; theme: DockviewTheme }> = [
  { key: 'dark', label: 'Dark (默认)', theme: themeDark },
  { key: 'light', label: 'Light', theme: themeLight },
  { key: 'visualStudio', label: 'Visual Studio', theme: themeVisualStudio },
  { key: 'abyss', label: 'Abyss', theme: themeAbyss },
  { key: 'abyssSpaced', label: 'Abyss Spaced', theme: themeAbyssSpaced },
  { key: 'dracula', label: 'Dracula', theme: themeDracula },
  { key: 'replit', label: 'Replit', theme: themeReplit },
  { key: 'lightSpaced', label: 'Light Spaced', theme: themeLightSpaced }
]

export function getThemeByKey(key: ThemeKey): DockviewTheme {
  return themeRegistry.find((t) => t.key === key)?.theme ?? themeDark
}
