import type { Migration } from '../lib/migrations'

/**
 * preferences.json 的 schema 迁移注册表。
 *
 * preferences.json 丢失或损坏不影响任何工程内容，因此迁移失败时上层代码应当
 * 直接回落到 DEFAULT_PREFERENCES，而不是阻塞应用启动。
 *
 * 添加迁移的模板见 src/main/project-storage/migrations.ts 顶部说明。
 */

export const preferencesMigrations: Migration[] = []
