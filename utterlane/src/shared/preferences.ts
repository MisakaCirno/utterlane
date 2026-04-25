/**
 * App 级偏好（跨工程共享，存放在 Electron userData 目录下的 preferences.json）。
 *
 * 判断什么该放进来：
 *   - 换一个工程打开后用户仍希望它生效 → 放这里
 *   - 仅在「当前工程做到哪了」的意义上有用 → 放 workspace.json
 *   - 影响导出结果 → 放 project.json / segments.json
 *
 * 丢失或损坏时应安全回落到出厂默认，不应影响任何工程内容。
 */

export const PREFERENCES_SCHEMA_VERSION = 1

export type DockThemeKey =
  | 'dark'
  | 'light'
  | 'visualStudio'
  | 'abyss'
  | 'abyssSpaced'
  | 'dracula'
  | 'replit'
  | 'lightSpaced'

export type TextAlign = 'left' | 'center' | 'right'

export type WindowBounds = {
  width?: number
  height?: number
  x?: number
  y?: number
  maximized?: boolean
}

export type SegmentsColumnWidths = {
  order?: number
  status?: number
  takes?: number
  duration?: number
}

export type AppPreferences = {
  schemaVersion: number

  appearance?: {
    dockTheme?: DockThemeKey
    /** 字体缩放倍率，1 = 默认；预留给后续字号系统 */
    fontScale?: number
    locale?: 'zh-CN' | 'en-US'
    /** Segment Timeline 里文案编辑框的对齐方式（默认居中，适合展示） */
    segmentTextAlign?: TextAlign
    /** Inspector 里文案编辑框的对齐方式（默认左对齐，适合长文本编辑） */
    inspectorTextAlign?: TextAlign
  }

  layout?: {
    /** dockview 序列化后的布局 JSON；结构由 dockview 自己定义，我们不解释 */
    dockLayout?: unknown
    segmentsColumnWidths?: SegmentsColumnWidths
  }

  window?: WindowBounds

  projectDefaults?: {
    sampleRate?: number
    channels?: 1 | 2
  }

  /** 最近打开的工程目录绝对路径，按最近优先 */
  recentProjects?: string[]

  /** 录音相关偏好 */
  recording?: {
    /**
     * 录音前倒计时秒数。0 = 关闭，按下录音键立即开始。
     * 即使设 1 秒也有用：足以避开按键音被收进起头。
     * 取值约束在 0 / 1 / 3 / 5 之中（见 PreferencesDialog 的选项）。
     */
    countdownSeconds?: number
  }
}

/**
 * 出厂默认值。preferences.json 不存在 / 解析失败 / schemaVersion 不识别时使用。
 * 所有字段都是可选的，这里只给出「有明确默认值」的那些。
 */
export const DEFAULT_PREFERENCES: AppPreferences = {
  schemaVersion: PREFERENCES_SCHEMA_VERSION,
  appearance: {
    dockTheme: 'dark',
    fontScale: 1,
    locale: 'zh-CN',
    segmentTextAlign: 'center',
    inspectorTextAlign: 'left'
  },
  projectDefaults: {
    sampleRate: 48000,
    channels: 1
  },
  recentProjects: [],
  recording: {
    countdownSeconds: 1
  }
}

/**
 * 深合并 patch 到 base，返回新对象。
 * 一层对象（appearance / layout / window / projectDefaults）按 key 合并；
 * 其余（如 recentProjects 数组、dockTheme 这类标量）整体替换。
 *
 * 抽出来是因为 update 操作从 UI 的角度往往只想更新某一个字段，
 * 不想每次都传完整的 appearance 对象。
 */
export function mergePreferences(
  base: AppPreferences,
  patch: Partial<AppPreferences>
): AppPreferences {
  const next: AppPreferences = { ...base, ...patch, schemaVersion: base.schemaVersion }

  if (patch.appearance) {
    next.appearance = { ...base.appearance, ...patch.appearance }
  }
  if (patch.layout) {
    next.layout = { ...base.layout, ...patch.layout }
    if (patch.layout.segmentsColumnWidths) {
      next.layout.segmentsColumnWidths = {
        ...base.layout?.segmentsColumnWidths,
        ...patch.layout.segmentsColumnWidths
      }
    }
  }
  if (patch.window) {
    next.window = { ...base.window, ...patch.window }
  }
  if (patch.projectDefaults) {
    next.projectDefaults = { ...base.projectDefaults, ...patch.projectDefaults }
  }
  if (patch.recording) {
    next.recording = { ...base.recording, ...patch.recording }
  }

  return next
}
