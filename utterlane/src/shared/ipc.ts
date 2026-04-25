/**
 * 所有 IPC 通道名的单一来源。
 *
 * 历史：之前 main 的每个模块都有自己的 *_IPC 常量，preload 必须把同名
 * 字面量「复述」一遍以避免 import main 代码（main 可能链入 electron 主
 * 进程模块，preload 上下文里 require 不到）。结果是改一个通道名要在两
 * 三处同步改，容易漏掉。
 *
 * 把字面量集中到 shared/ipc.ts：shared 不持有任何运行时依赖（纯类型 +
 * 字面量），main 与 preload 都安全 import。改一处即可。
 */

export const PREFERENCES_IPC = {
  get: 'preferences:get',
  update: 'preferences:update',
  changed: 'preferences:changed'
} as const

export const PROJECT_IPC = {
  new: 'project:new',
  open: 'project:open',
  openPath: 'project:open-path',
  close: 'project:close',
  current: 'project:current',
  saveWorkspace: 'project:save-workspace',
  saveSegments: 'project:save-segments',
  saveProject: 'project:save-project',
  readTakeFile: 'project:read-take-file'
} as const

export const RECORDING_IPC = {
  writeTake: 'recording:write-take'
} as const

export const EXPORT_IPC = {
  audioWav: 'export:audio-wav',
  subtitlesSrt: 'export:subtitles-srt'
} as const

export const AUDIO_AUDIT_IPC = {
  scan: 'audio-audit:scan',
  remap: 'audio-audit:remap',
  saveOrphanAsTake: 'audio-audit:save-orphan-as-take',
  deleteOrphan: 'audio-audit:delete-orphan'
} as const

export const LOGS_IPC = {
  openFolder: 'logs:open-folder'
} as const

export const APP_IPC = {
  getInfo: 'app:get-info',
  /** main → renderer：未捕获异常 / unhandledRejection 广播 */
  crash: 'app:crash'
} as const

export const WINDOW_IPC = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  closeRequest: 'window:close-request',
  closeConfirmed: 'window:close-confirmed',
  isMaximized: 'window:is-maximized',
  maximizeState: 'window:maximize-state'
} as const
