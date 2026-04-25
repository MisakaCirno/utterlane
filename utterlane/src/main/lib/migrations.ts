import { promises as fs } from 'fs'
import { dirname, basename, join } from 'path'

/**
 * 通用 schema 迁移框架。
 *
 * 设计目标：
 *   - 当前所有 schemaVersion 都是 1，不存在实际迁移函数。本框架先把基础设施搭好，
 *     下一次破坏性 schema 改动只需要往对应模块的 migrations 数组里追加一条。
 *   - 不增加正常打开流程的额外 IO：版本一致时直接跳过迁移逻辑。
 *   - 迁移前对原文件做一次磁盘备份，命名形式 `<原文件名>.bak-v<旧版本>`，
 *     例如 `project.json` 升级前会生成 `project.json.bak-v1`。
 *     备份只保留最近一次：写入新备份前先清掉同文件的旧备份，避免目录里积累
 *     一串 `.bak-v1` `.bak-v2` `.bak-v3`。
 *   - 高于当前版本（来自更新版本的软件）一律拒绝；不尝试降级，因为未来字段
 *     语义可能不向后兼容。
 *   - 迁移失败时不写入新内容，原文件保持不动；调用方按文件等级（致命 / 可恢复）
 *     决定是抛错还是回落到默认值。
 */

/**
 * 单条迁移：把 from 版本的 raw 数据升级到 to 版本。
 *
 * 必须满足 to === from + 1：迁移链按相邻版本逐步推进，方便审阅每一步的字段
 * 变更，也避免「跨多版本一次升」时漏改某个字段。
 *
 * raw 类型用 unknown 是有意的：旧版本数据结构和现行 TS 类型可能不一致，强行
 * 标注成现行类型反而会掩盖问题。迁移函数内部按 from 版本的 schema 去读 raw，
 * 输出按 to 版本的 schema 构造新对象。
 */
export type Migration = {
  from: number
  to: number
  migrate: (raw: unknown) => unknown
}

/**
 * 跑迁移链：从 fromVersion 一步步升到 targetVersion。
 *
 * 调用前提：fromVersion < targetVersion。等于或大于的情况由调用方自己处理
 * （等于走快路径，大于直接拒绝），这里只负责「升级」这一段。
 *
 * 找不到下一步迁移、或者迁移声明的 to !== from + 1 时抛错——保证迁移链
 * 严格相邻推进，避免「跨多版本一次升」漏改某个字段或留下不一致状态。
 */
export function runMigrations(
  raw: unknown,
  fromVersion: number,
  targetVersion: number,
  migrations: Migration[]
): unknown {
  let current = raw
  let currentVersion = fromVersion
  while (currentVersion < targetVersion) {
    const m = migrations.find((mig) => mig.from === currentVersion)
    if (!m) {
      throw new Error(
        `No migration registered from v${currentVersion} (target v${targetVersion}). ` +
          `Did you forget to add a migration after bumping the schema version?`
      )
    }
    if (m.to !== m.from + 1) {
      // 迁移必须 to === from + 1。跳跃式声明（比如 from:1, to:3）会导致
      // v2 永远跑不到、字段差异被默默吞掉。在跑前显式拒绝
      throw new Error(
        `Migration v${m.from} → v${m.to} is not adjacent. Migrations must step by 1.`
      )
    }
    current = m.migrate(current)
    currentVersion = m.to
  }
  return current
}

/**
 * 升级前把原文件备份到同目录。返回备份文件的绝对路径。
 *
 * 命名：<原文件名>.bak-v<旧版本>。原文件名包含扩展名，例如 `project.json` →
 * `project.json.bak-v1`。这种形式对用户最直观——文件按字典序排列时备份会紧
 * 跟原文件出现。
 *
 * 保留策略：写入新备份前先清掉同前缀的所有旧 `.bak-v*`，目录始终只保留一份
 * 最新备份。
 */
export async function backupBeforeMigration(filePath: string, oldVersion: number): Promise<string> {
  const dir = dirname(filePath)
  const name = basename(filePath)
  const backupName = `${name}.bak-v${oldVersion}`
  const backupPath = join(dir, backupName)

  // 清旧备份。前缀匹配 `<name>.bak-v`，只删完全符合该模式的文件，
  // 不动用户自己丢进来的同名文件
  try {
    const entries = await fs.readdir(dir)
    const prefix = `${name}.bak-v`
    for (const entry of entries) {
      if (entry === backupName) continue // 即将覆盖的目标文件留给后面的 copyFile
      if (entry.startsWith(prefix) && /^\d+$/.test(entry.slice(prefix.length))) {
        await fs.unlink(join(dir, entry)).catch(() => {})
      }
    }
  } catch {
    // 读目录失败（权限 / ENOENT）不阻塞迁移，但备份就生不出来——继续升级风险更高，
    // 所以直接抛
    throw new Error(`Failed to enumerate ${dir} for backup cleanup`)
  }

  // copyFile 而不是 rename：原文件在迁移过程中仍然存在更安全。
  // 即使迁移函数中途抛错、新内容没写成功，原文件至少还在原位
  await fs.copyFile(filePath, backupPath)
  return backupPath
}
