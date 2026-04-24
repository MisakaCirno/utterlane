import { promises as fs } from 'fs'
import { projectPaths } from './paths'

/**
 * 单实例锁：同一个工程目录同时只能被一个 Utterlane 进程打开。
 *
 * 实现：在工程根目录下写 `.utterlane-lock` 文件，内容是当前进程的 PID 和启动时间戳。
 * 另一个进程尝试打开同一工程时：
 *   - 读锁文件，拿到 PID
 *   - 用 `process.kill(pid, 0)` 探测该进程是否仍然存活
 *     （发送信号 0：不实际杀进程，但如果进程不存在会抛 ESRCH）
 *   - 若存活 → 拒绝打开，提示用户该工程已在另一窗口里打开
 *   - 若已不存在（上次异常退出遗留）→ 视为失效锁，覆盖后继续打开
 *
 * 注意：锁的权威性依赖「PID 未被复用到另一个无关进程」这个假设。
 * 操作系统 PID 复用极快时存在误判风险，但实际上几乎不会和一个刚好也在写 Utterlane
 * 锁的随机进程冲突，成本-收益比下这个简化是值得的。
 */

type LockFile = {
  pid: number
  /** ISO 时间戳，仅做调试展示，不参与判断 */
  startedAt: string
}

export type LockAcquireResult = { ok: true } | { ok: false; reason: 'busy'; heldBy: LockFile }

function isProcessAlive(pid: number): boolean {
  try {
    // signal=0 不发送实际信号，只做存在性检测
    process.kill(pid, 0)
    return true
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    // ESRCH: 进程不存在；EPERM: 进程存在但无权访问（存活）
    return e.code === 'EPERM'
  }
}

export async function acquireLock(dir: string): Promise<LockAcquireResult> {
  const path = projectPaths(dir).lockFile

  // 先检查是否已有活跃锁
  try {
    const raw = await fs.readFile(path, 'utf8')
    const existing = JSON.parse(raw) as LockFile
    if (existing.pid !== process.pid && isProcessAlive(existing.pid)) {
      return { ok: false, reason: 'busy', heldBy: existing }
    }
    // 失效锁或自己的旧锁，可以覆盖
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      // 锁文件存在但读不出来（权限 / 损坏）。保守起见拒绝打开。
      throw new Error(`无法检查工程锁：${e.message}`)
    }
    // ENOENT = 没有锁，可以直接获取
  }

  const content: LockFile = {
    pid: process.pid,
    startedAt: new Date().toISOString()
  }
  await fs.writeFile(path, JSON.stringify(content, null, 2), 'utf8')
  return { ok: true }
}

/**
 * 释放锁：仅当锁确实属于当前进程时才删除，避免误删别人的锁。
 * 异常时静默（释放失败不影响程序退出）。
 */
export async function releaseLock(dir: string): Promise<void> {
  const path = projectPaths(dir).lockFile
  try {
    const raw = await fs.readFile(path, 'utf8')
    const existing = JSON.parse(raw) as LockFile
    if (existing.pid === process.pid) {
      await fs.unlink(path)
    }
  } catch {
    // 锁已不存在或读取失败，都不是问题
  }
}
