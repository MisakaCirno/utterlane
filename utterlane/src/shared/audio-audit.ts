/**
 * 音频文件审计相关的共享类型。
 *
 * 概念区分：
 *   - 缺失 Take：segments.json 引用了某个 Take.filePath，但磁盘上对应文件
 *     不存在；典型原因是用户手工删了 audios/ 下的文件，或工程目录被部分搬移
 *   - 孤儿 WAV：磁盘上 audios/ 里存在但 segments.json 没引用的 WAV；典型
 *     原因是删 Take / 删 Segment 时只改了 segments.json，没动文件（这是
 *     有意的，避免误删用户数据）
 *
 * 这两类问题各有一个修复入口（手动指定 / 删除 / 反向保存为 Take），都集中
 * 在 AudioAuditDialog 里。
 */

export type MissingTake = {
  segmentId: string
  takeId: string
  /** 期望的相对路径（相对工程目录）；UI 用来展示「找不到这个文件」 */
  expectedPath: string
  /** Segment 文案，用于列表显示 */
  segmentText: string
  /** Segment 在 order 中的下标（0-based；UI 渲染时 +1 显示） */
  segmentIndex: number
}

export type OrphanFile = {
  /** 相对工程目录的路径，例如 audios/<segId>/<takeId>.wav */
  relativePath: string
  sizeBytes: number
  /** mtime 的毫秒时间戳，UI 排序用 */
  mtimeMs: number
}

export type AuditScanResult = {
  missing: MissingTake[]
  orphans: OrphanFile[]
}

/**
 * 把任意 WAV 文件复制到指定 Take 的正式路径，恢复缺失态。
 * 复制完会重新解码计算 durationMs（用户挑的源文件时长可能和 segments.json
 * 里旧记录不一致）。
 */
export type RemapTakeResult =
  | { ok: true; relativePath: string; durationMs: number }
  | { ok: false; message: string; canceled?: boolean }

/**
 * 把孤儿 WAV「过户」到某个 Segment 名下作为新 Take。文件会被移动（不是复制）
 * 到 audios/<segId>/<newTakeId>.wav，原孤儿位置不再存在。
 */
export type SaveOrphanAsTakeResult =
  | { ok: true; segmentId: string; takeId: string; relativePath: string; durationMs: number }
  | { ok: false; message: string }

/** 把孤儿文件移到操作系统回收站（不直接 unlink，给用户后悔余地） */
export type DeleteOrphanResult = { ok: true } | { ok: false; message: string }
