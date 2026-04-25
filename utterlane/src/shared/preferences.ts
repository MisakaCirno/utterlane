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

// ---------------------------------------------------------------------------
// 快捷键
// ---------------------------------------------------------------------------

/**
 * 单个键位绑定。key 直接采用 KeyboardEvent.key 的命名：单字符（'r' / ' '）
 * 用小写存储；特殊键用全名（'ArrowUp' / 'Escape'）。modifier 缺省 = false。
 *
 * ctrl 字段在 Windows / Linux 表示 Ctrl 键，在 macOS 同时匹配 Cmd（Meta）——
 * 让同一份偏好跨平台都自然工作。需要分别绑定时再扩字段
 */
export type KeyBinding = {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

/**
 * 可被用户自定义的动作 ID 清单。仅放传输 / 导航类——OS 约定的 Ctrl+Z 等
 * 维持硬编码，避免用户改了之后跨应用习惯断裂
 */
export const CUSTOMIZABLE_ACTIONS = [
  'record',
  'rerecord',
  'playSegment',
  'playProject',
  'prevSegment',
  'nextSegment',
  'stopOrCancel'
] as const
export type CustomizableActionId = (typeof CUSTOMIZABLE_ACTIONS)[number]

export const DEFAULT_KEYBINDINGS: Record<CustomizableActionId, KeyBinding> = {
  record: { key: 'r' },
  rerecord: { key: 'r', shift: true },
  playSegment: { key: ' ' },
  playProject: { key: ' ', shift: true },
  prevSegment: { key: 'ArrowUp' },
  nextSegment: { key: 'ArrowDown' },
  stopOrCancel: { key: 'Escape' }
}

/**
 * 当前生效的绑定（preferences 覆盖 fallback 默认）。
 * 用户偏好里值为 null 表示「显式取消该动作的快捷键」（区别于 undefined =
 * 没改过、走默认）
 */
export function resolveBindings(
  prefs: AppPreferences
): Record<CustomizableActionId, KeyBinding | null> {
  const overrides = prefs.keyboard?.bindings ?? {}
  const out = {} as Record<CustomizableActionId, KeyBinding | null>
  for (const id of CUSTOMIZABLE_ACTIONS) {
    if (id in overrides) {
      // 用户显式设过（包括 null / undefined）
      const v = overrides[id]
      out[id] = v === null ? null : (v ?? DEFAULT_KEYBINDINGS[id])
    } else {
      out[id] = DEFAULT_KEYBINDINGS[id]
    }
  }
  return out
}

/** 判断 KeyboardEvent 是否匹配某个绑定 */
export function bindingMatches(b: KeyBinding, e: KeyboardEvent): boolean {
  const eKey = e.key
  // 单字符 key 大小写不敏感（例如 'r' 在 Shift 按下时变 'R'，仍属于同一键）
  if (b.key.length === 1) {
    if (eKey.toLowerCase() !== b.key.toLowerCase()) return false
  } else {
    if (eKey !== b.key) return false
  }
  const eCtrl = e.ctrlKey || e.metaKey
  if ((b.ctrl ?? false) !== eCtrl) return false
  if ((b.alt ?? false) !== e.altKey) return false
  if ((b.shift ?? false) !== e.shiftKey) return false
  return true
}

/** 把绑定格式化成展示字符串，例如「Shift+R」「Ctrl+,」「↑」 */
export function formatBinding(b: KeyBinding): string {
  const parts: string[] = []
  if (b.ctrl) parts.push('Ctrl')
  if (b.alt) parts.push('Alt')
  if (b.shift) parts.push('Shift')
  let key = b.key
  if (key === ' ') key = 'Space'
  else if (key === 'ArrowUp') key = '↑'
  else if (key === 'ArrowDown') key = '↓'
  else if (key === 'ArrowLeft') key = '←'
  else if (key === 'ArrowRight') key = '→'
  else if (key === 'Escape') key = 'Esc'
  else if (key === 'Enter') key = 'Enter'
  else if (key.length === 1) key = key.toUpperCase()
  parts.push(key)
  return parts.join('+')
}

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

  /** 用户自定义快捷键 */
  keyboard?: {
    /**
     * 用户对各动作绑定的覆盖。键缺失或值为 null 时回落到 DEFAULT_KEYBINDINGS。
     * 只覆盖「可定制」的传输 / 导航类动作；OS 级约定（Ctrl+Z 撤销 / Ctrl+N
     * 新建等）不进入这个表，保持跨平台一致
     */
    bindings?: Partial<Record<string, KeyBinding | null>>
  }

  /** 录音相关偏好 */
  recording?: {
    /**
     * 录音前倒计时秒数。0 = 关闭，按下录音键立即开始。
     * 即使设 1 秒也有用：足以避开按键音被收进起头。
     * 取值约束在 0 / 1 / 3 / 5 之中（见 PreferencesDialog 的选项）。
     */
    countdownSeconds?: number

    /**
     * 录音输入设备 ID（来自 navigator.mediaDevices.enumerateDevices）。
     * undefined / 空字符串 = 系统默认设备。
     *
     * deviceId 在同一应用安装内通常稳定，但跨设备拔插 / 系统重启后可能失效；
     * 录音启动时若约束失败（OverconstrainedError），会提示用户重新选择
     */
    inputDeviceId?: string
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
 * 浅合并：把 patch 中 value !== undefined 的字段并入 base，并把 value ===
 * undefined 的字段从结果里删掉。
 *
 * 这是 mergePreferences 的语义关键：UI 用 `update({ keyboard: { bindings:
 * { record: undefined } } })` 表达「重置该绑定」，希望最终 JSON 里没有
 * record 这个 key——而不是 `{ record: undefined }`（JSON.stringify 会写成
 * `{}` 但内存里 `'record' in bindings` 仍然为 true，破坏 resolveBindings
 * 的「显式覆盖 vs 未覆盖」判定）。
 *
 * 调用方传 null 表达「显式取消该动作的快捷键」，与 undefined 区分开——
 * null 会被保留。
 */
function mergePartial<T extends object>(base: T | undefined, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base ?? {}) }
  for (const key of Object.keys(patch)) {
    const v = (patch as Record<string, unknown>)[key]
    if (v === undefined) {
      delete out[key]
    } else {
      out[key] = v
    }
  }
  return out as T
}

/**
 * 深合并 patch 到 base，返回新对象。
 * 一层对象（appearance / layout / window / projectDefaults）按 key 合并；
 * 其余（如 recentProjects 数组、dockTheme 这类标量）整体替换。
 *
 * 抽出来是因为 update 操作从 UI 的角度往往只想更新某一个字段，
 * 不想每次都传完整的 appearance 对象。patch 中显式为 undefined 的字段
 * 视为「请删除该字段」（见 mergePartial 注释）。
 */
export function mergePreferences(
  base: AppPreferences,
  patch: Partial<AppPreferences>
): AppPreferences {
  const next: AppPreferences = { ...base, schemaVersion: base.schemaVersion }
  // 顶层标量字段：用 mergePartial 让 undefined 也能删
  for (const key of Object.keys(patch) as Array<keyof AppPreferences>) {
    if (key === 'schemaVersion') continue
    if (
      key === 'appearance' ||
      key === 'layout' ||
      key === 'window' ||
      key === 'projectDefaults' ||
      key === 'recording' ||
      key === 'keyboard'
    ) {
      continue // 嵌套对象走专门的合并分支
    }
    const v = patch[key]
    if (v === undefined) {
      delete next[key]
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(next as any)[key] = v
    }
  }

  if (patch.appearance) {
    next.appearance = mergePartial(base.appearance, patch.appearance)
  }
  if (patch.layout) {
    const layoutNext = mergePartial(base.layout, patch.layout)
    if (patch.layout.segmentsColumnWidths) {
      layoutNext.segmentsColumnWidths = mergePartial(
        base.layout?.segmentsColumnWidths,
        patch.layout.segmentsColumnWidths
      )
    }
    next.layout = layoutNext
  }
  if (patch.window) {
    next.window = mergePartial(base.window, patch.window)
  }
  if (patch.projectDefaults) {
    next.projectDefaults = mergePartial(base.projectDefaults, patch.projectDefaults)
  }
  if (patch.recording) {
    next.recording = mergePartial(base.recording, patch.recording)
  }
  if (patch.keyboard) {
    const kbNext = mergePartial(base.keyboard, patch.keyboard)
    if (patch.keyboard.bindings) {
      kbNext.bindings = mergePartial(base.keyboard?.bindings, patch.keyboard.bindings)
    }
    next.keyboard = kbNext
  }

  return next
}
