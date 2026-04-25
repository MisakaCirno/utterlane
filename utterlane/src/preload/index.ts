import { contextBridge, ipcRenderer } from 'electron'
import type { AppPreferences } from '@shared/preferences'
import type { Project, ProjectBundle, SegmentsFile, WorkspaceFile } from '@shared/project'
import type { WriteTakeResult } from '@shared/recording'
import type { AppInfo } from '@shared/appInfo'
import type { CrashInfo } from '@shared/crash'
import type { ExportAudioOptions } from '@shared/export'
import type {
  AuditScanResult,
  DeleteOrphanResult,
  RemapTakeResult,
  SaveOrphanAsTakeResult
} from '@shared/audio-audit'
import {
  APP_IPC,
  AUDIO_AUDIT_IPC,
  EXPORT_IPC,
  LOGS_IPC,
  PREFERENCES_IPC,
  PROJECT_IPC,
  RECORDING_IPC,
  WINDOW_IPC
} from '@shared/ipc'

/**
 * IPC 通道名一律从 @shared/ipc import——shared 是纯字面量 + 类型，不持有
 * 任何运行时依赖，preload 上下文也能安全引用。改通道名只动 shared/ipc.ts
 * 一处即可，不会再出现 main / preload 字面量同步漂移
 */

/** 与 main 的 OpenResult 保持同步；preload 不 import main 代码，所以在这里复述结构 */
export type OpenResult =
  | { ok: true; bundle: ProjectBundle }
  | { ok: false; reason: 'busy'; heldByPid: number }
  | { ok: false; reason: 'invalid'; message: string; canceled?: boolean }

/** 与 main 的 SaveSegmentsResult 保持同步 */
export type SaveSegmentsResult = { ok: true } | { ok: false; message: string }

/** 与 main 的 SaveProjectResult 保持同步 */
export type SaveProjectResult = { ok: true } | { ok: false; message: string }

/** 与 main 的 ExportResult 保持同步 */
export type ExportResult =
  | { ok: true; filePath: string; skipped: number }
  | { ok: false; message: string; canceled?: boolean }

const api = {
  window: {
    minimize: (): void => ipcRenderer.send(WINDOW_IPC.minimize),
    toggleMaximize: (): void => ipcRenderer.send(WINDOW_IPC.toggleMaximize),
    close: (): void => ipcRenderer.send(WINDOW_IPC.close),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(WINDOW_IPC.isMaximized),
    onMaximizeStateChange: (cb: (maximized: boolean) => void): (() => void) => {
      const listener = (_: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on(WINDOW_IPC.maximizeState, listener)
      return () => ipcRenderer.removeListener(WINDOW_IPC.maximizeState, listener)
    },
    /**
     * 订阅 main 发出的关窗请求。renderer 检查 saved 状态，
     * 必要时弹确认框，最终调 confirmClose 才真正关闭。
     * 返回 unsubscribe 函数。
     */
    onCloseRequest: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(WINDOW_IPC.closeRequest, listener)
      return () => ipcRenderer.removeListener(WINDOW_IPC.closeRequest, listener)
    },
    /** 同意关闭 —— main 会跳过第二次 close 的拦截 */
    confirmClose: (): void => ipcRenderer.send(WINDOW_IPC.closeConfirmed)
  },

  preferences: {
    /** 获取当前偏好快照。renderer 启动时调用一次用于 hydration。 */
    get: (): Promise<AppPreferences> => ipcRenderer.invoke(PREFERENCES_IPC.get),

    /**
     * 发送 partial patch。main 侧会合并 + debounce 写盘 + 广播变更。
     * fire-and-forget：renderer 拿到的最终值通过 onChange 回推。
     */
    update: (patch: Partial<AppPreferences>): void =>
      ipcRenderer.send(PREFERENCES_IPC.update, patch),

    /**
     * 订阅偏好变更事件。用于 renderer 端保持本地副本与 main 同步
     * （包括自己发起的 update 被 merge 之后的完整状态）。
     * 返回一个 unsubscribe 函数，组件卸载时调用以避免泄露。
     */
    onChange: (cb: (prefs: AppPreferences) => void): (() => void) => {
      const listener = (_: unknown, prefs: AppPreferences): void => cb(prefs)
      ipcRenderer.on(PREFERENCES_IPC.changed, listener)
      return () => ipcRenderer.removeListener(PREFERENCES_IPC.changed, listener)
    }
  },

  project: {
    /** 弹目录选择对话框创建新工程；返回的 bundle 即「打开」后的完整状态 */
    new: (): Promise<OpenResult> => ipcRenderer.invoke(PROJECT_IPC.new),

    /** 弹目录选择对话框打开现有工程 */
    open: (): Promise<OpenResult> => ipcRenderer.invoke(PROJECT_IPC.open),

    /** 按给定路径打开（最近工程条目点击时使用） */
    openPath: (path: string): Promise<OpenResult> => ipcRenderer.invoke(PROJECT_IPC.openPath, path),

    close: (): Promise<void> => ipcRenderer.invoke(PROJECT_IPC.close),

    /** 查询当前正在打开的工程路径，null 表示无活动工程 */
    getCurrent: (): Promise<string | null> => ipcRenderer.invoke(PROJECT_IPC.current),

    /** 上报整份 workspace 状态给 main 做 debounce 保存 */
    saveWorkspace: (next: WorkspaceFile): void => ipcRenderer.send(PROJECT_IPC.saveWorkspace, next),

    /**
     * 立即保存 segments.json。等 main 写盘成功 / 失败后才返回，
     * renderer 据此切换 saved 标记、在失败时提示用户。
     */
    saveSegments: (next: SegmentsFile): Promise<SaveSegmentsResult> =>
      ipcRenderer.invoke(PROJECT_IPC.saveSegments, next),

    /**
     * 保存 project.json。renderer 传完整 Project 对象（不含 schemaVersion），
     * main 加上当前 schemaVersion 后原子写入。updatedAt 由 renderer 在 patch
     * 应用时一并写入，main 不会覆盖。
     */
    saveProject: (next: Project): Promise<SaveProjectResult> =>
      ipcRenderer.invoke(PROJECT_IPC.saveProject, next),

    /** 读取工程内某个 Take 文件（relativePath 来自 Take.filePath），用于播放 */
    readTakeFile: (relativePath: string): Promise<ArrayBuffer> =>
      ipcRenderer.invoke(PROJECT_IPC.readTakeFile, relativePath)
  },

  recording: {
    /**
     * 把一段录好的 WAV 写进工程目录。
     * 走 temp/<takeId>.wav → rename 到 audios/<segmentId>/<takeId>.wav，
     * 返回相对路径方便直接塞进 Take.filePath。
     */
    writeTake: (segmentId: string, takeId: string, buffer: ArrayBuffer): Promise<WriteTakeResult> =>
      ipcRenderer.invoke(RECORDING_IPC.writeTake, { segmentId, takeId, buffer })
  },

  export: {
    /**
     * 导出音频。options 决定输出采样率 / 位深格式 / 拼接还是拆分。
     * concat 模式弹文件保存对话框；split 模式弹文件夹选择对话框。
     */
    audioWav: (options: ExportAudioOptions): Promise<ExportResult> =>
      ipcRenderer.invoke(EXPORT_IPC.audioWav, options),
    /** 弹保存对话框，按 order + selectedTakeId 生成 SRT 字幕 */
    subtitlesSrt: (): Promise<ExportResult> => ipcRenderer.invoke(EXPORT_IPC.subtitlesSrt)
  },

  audioAudit: {
    /** 扫描当前工程的缺失 Take 与孤儿 WAV。无活动工程时返回空结果 */
    scan: (): Promise<AuditScanResult> => ipcRenderer.invoke(AUDIO_AUDIT_IPC.scan),

    /**
     * 缺失 Take 修复：弹文件选择对话框让用户挑一个 WAV，复制到该 Take 的
     * 期望路径并解码新时长。renderer 拿到结果后更新 Take.durationMs
     * 并把 takeId 从 missingTakeIds 集合里移掉
     */
    remap: (segmentId: string, takeId: string): Promise<RemapTakeResult> =>
      ipcRenderer.invoke(AUDIO_AUDIT_IPC.remap, { segmentId, takeId }),

    /**
     * 把孤儿 WAV 转入指定 Segment 名下作为新 Take。main 侧 rename 后返回
     * 新 takeId / 路径 / 时长，renderer 据此往 segmentsById 追加新 Take
     */
    saveOrphanAsTake: (
      orphanRelativePath: string,
      segmentId: string
    ): Promise<SaveOrphanAsTakeResult> =>
      ipcRenderer.invoke(AUDIO_AUDIT_IPC.saveOrphanAsTake, {
        orphanRelativePath,
        segmentId
      }),

    /** 把孤儿 WAV 移到操作系统回收站（不直接 unlink） */
    deleteOrphan: (relativePath: string): Promise<DeleteOrphanResult> =>
      ipcRenderer.invoke(AUDIO_AUDIT_IPC.deleteOrphan, relativePath)
  },

  logs: {
    /** 在系统文件管理器里打开日志目录。成功返回 null，失败返回错误文案。 */
    openFolder: (): Promise<string | null> => ipcRenderer.invoke(LOGS_IPC.openFolder)
  },

  app: {
    /** 应用 / 运行时元信息（版本、Electron / Chromium / Node 版本、平台等） */
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_IPC.getInfo),

    /**
     * 订阅来自 main 的崩溃事件（uncaughtException / unhandledRejection）。
     * Renderer 自身的错误不走这条——renderer 在本地直接 dispatch 即可。
     * 返回 unsubscribe 函数。
     */
    onCrash: (cb: (info: CrashInfo) => void): (() => void) => {
      const listener = (_: unknown, info: CrashInfo): void => cb(info)
      ipcRenderer.on(APP_IPC.crash, listener)
      return () => ipcRenderer.removeListener(APP_IPC.crash, listener)
    }
  }
}

if (process.contextIsolated) {
  try {
    // 仅暴露我们自己的 api。原本还会暴露 @electron-toolkit 的 electronAPI
    // （包含通用 ipcRenderer.send/on），扩大攻击面但代码里没人用——索性
    // 移除，CSP + 最小暴露面双保险
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}

export type UtterlaneApi = typeof api
