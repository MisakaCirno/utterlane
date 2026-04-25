import { promises as fs } from 'fs'
import { join } from 'path'
import { app, BrowserWindow } from 'electron'
import {
  DEFAULT_PREFERENCES,
  mergePreferences,
  PREFERENCES_SCHEMA_VERSION,
  type AppPreferences
} from '@shared/preferences'
import { writeJsonAtomic } from '../lib/atomic-write'
import { backupBeforeMigration, runMigrations } from '../lib/migrations'
import { preferencesMigrations } from './migrations'

/**
 * 写盘节流时长：UI 上大多数偏好变更都是用户连续操作（拖拽窗口、调列宽、
 * 移动 dock），500ms 足够把一串连续操作合并成一次写入，又不会在用户操作结束后
 * 让磁盘状态落后太久。
 */
const SAVE_DEBOUNCE_MS = 500

const FILE_NAME = 'preferences.json'

/** 发给 renderer 的变更事件名。renderer 端可以订阅它来同步本地副本 */
export const PREFERENCES_CHANGED_EVENT = 'preferences:changed'

/**
 * 偏好存储管理器。
 *
 * 全局单例：整个 App 进程只维护一份内存副本，所有 renderer 通过 IPC 读写。
 * 生命周期：
 *   - app ready 前调用 init() 完成同步加载（窗口创建需要读 window bounds）
 *   - 运行期 update() 合并改动，debounce 写盘 + 广播到所有 BrowserWindow
 *   - 进程退出前 flush() 清空 pending 写入
 */
class PreferencesStore {
  private current: AppPreferences = DEFAULT_PREFERENCES
  private filePath: string = ''
  private saveTimer: NodeJS.Timeout | null = null
  private dirty = false

  /**
   * 启动时加载一次。失败（文件不存在 / 解析失败 / schema 迁移失败 / 高版本拒绝）
   * 一律回落到默认值，不抛异常——一个损坏的偏好文件不应阻塞应用启动。
   */
  async init(): Promise<void> {
    this.filePath = join(app.getPath('userData'), FILE_NAME)
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsedRaw: unknown = JSON.parse(raw)
      const version =
        typeof parsedRaw === 'object' &&
        parsedRaw !== null &&
        typeof (parsedRaw as { schemaVersion?: unknown }).schemaVersion === 'number'
          ? ((parsedRaw as { schemaVersion: number }).schemaVersion as number)
          : 0

      if (version === PREFERENCES_SCHEMA_VERSION) {
        this.current = { ...DEFAULT_PREFERENCES, ...(parsedRaw as AppPreferences) }
        return
      }

      if (version > PREFERENCES_SCHEMA_VERSION) {
        console.warn(
          `[preferences] schemaVersion ${version} is from a newer Utterlane build, using defaults`
        )
        return
      }

      // 低版本：备份 + 迁移 + 写回。失败时回落到默认值（非致命）
      try {
        await backupBeforeMigration(this.filePath, version)
        const migrated = runMigrations(
          parsedRaw,
          version,
          PREFERENCES_SCHEMA_VERSION,
          preferencesMigrations
        ) as AppPreferences
        await writeJsonAtomic(this.filePath, migrated)
        this.current = { ...DEFAULT_PREFERENCES, ...migrated }
        console.log(
          `[preferences] migrated from v${version} to v${PREFERENCES_SCHEMA_VERSION} (backup saved)`
        )
      } catch (migrateErr) {
        console.warn(
          `[preferences] migration from v${version} failed, using defaults:`,
          (migrateErr as Error).message
        )
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'ENOENT') {
        console.warn(`[preferences] load failed, using defaults:`, e.message)
      }
    }
  }

  get snapshot(): AppPreferences {
    return this.current
  }

  /**
   * 合并式更新：patch 里只需要提供要改的字段，其他字段保持不变。
   * 写入以 debounce 方式落盘，同时立即把新快照广播给所有窗口。
   */
  update(patch: Partial<AppPreferences>): void {
    const next = mergePreferences(this.current, patch)
    if (next === this.current) return
    this.current = next
    this.dirty = true
    this.scheduleSave()
    this.broadcast()
  }

  /**
   * 立即把 pending 写入刷盘。用于应用退出前。
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (this.dirty) {
      await this.saveNow()
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveNow()
    }, SAVE_DEBOUNCE_MS)
  }

  private async saveNow(): Promise<void> {
    // 取当前快照而不是持有闭包变量，避免写盘期间又被改动导致数据错乱。
    const snapshot = this.current
    try {
      await writeJsonAtomic(this.filePath, snapshot)
      this.dirty = false
    } catch (err) {
      // 偏好写盘失败不是致命错误，留待下次 update 再试。
      // 不对用户抛错是为了避免界面出现频繁的「保存失败」提示，让主流程继续可用。
      console.error('[preferences] save failed:', err)
    }
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(PREFERENCES_CHANGED_EVENT, this.current)
      }
    }
  }
}

export const preferencesStore = new PreferencesStore()
