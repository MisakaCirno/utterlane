import type { Migration } from '../lib/migrations'

/**
 * 工程文件的 schema 迁移注册表。
 *
 * 当前所有文件都是 schemaVersion 1，三个数组都是空的。下次破坏性改动时按
 * 下面的模板往对应数组里追加一条迁移函数：
 *
 *   {
 *     from: 1,
 *     to: 2,
 *     migrate: (raw) => {
 *       const old = raw as OldShape  // OldShape 是 v1 时期的字段定义，
 *                                    // 必要时把 v1 的类型从 git 历史里复制一份到这里
 *       return {
 *         ...old,
 *         schemaVersion: 2,
 *         // 字段变更：
 *         //   - 新增字段：填合理默认值
 *         //   - 改名字段：从 old 读旧名，写到新名
 *         //   - 删除字段：在新对象里不再包含
 *       }
 *     }
 *   }
 *
 * 命名约定：`from` + `to` 必须相邻（`to === from + 1`），多版本跨度由 runner
 * 串行执行多条迁移完成。这样每条迁移的职责单一，方便 review。
 */

export const projectMigrations: Migration[] = []
export const segmentsMigrations: Migration[] = []
export const workspaceMigrations: Migration[] = []
