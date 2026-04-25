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
 * === 原子性 ===
 *
 * 使用 fs.open(path, 'wx')（O_CREAT|O_EXCL）原子创建——同时打开两个进程时
 * 操作系统保证只有一个 open() 成功，另一个收到 EEXIST。无 EXCL 的旧实现
 * 是先 readFile 判断、再 writeFile 创建：两个进程都会读到 ENOENT 然后都
 * writeFile，后写赢但都以为自己持锁。
 *
 * EEXIST 时进入「探活 → 决定是否抢锁」分支：仅当占用方进程不存活（僵尸锁）
 * 才覆盖；活进程则拒绝打开。
 *
 * 注意：锁的权威性依赖「PID 未被复用到另一个无关进程」这个假设。
 * 操作系统 PID 复用极快时存在误判风险，但实际上几乎不会和一个刚好也在写
 * Utterlane 锁的随机进程冲突，成本-收益比下这个简化是值得的。
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

async function writeLockExclusive(path: string, content: LockFile): Promise<boolean> {
  // 'wx' = O_CREAT | O_EXCL | O_WRONLY：文件已存在直接抛 EEXIST
  let handle: import('fs').promises.FileHandle | null = null
  try {
    handle = await fs.open(path, 'wx')
    await handle.writeFile(JSON.stringify(content, null, 2), 'utf8')
    return true
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'EEXIST') return false
    throw err
  } finally {
    await handle?.close()
  }
}

export async function acquireLock(dir: string): Promise<LockAcquireResult> {
  const path = projectPaths(dir).lockFile
  const content: LockFile = {
    pid: process.pid,
    startedAt: new Date().toISOString()
  }

  // 第一次尝试 EXCL 创建——绝大多数情况（无遗留锁）一步成功
  if (await writeLockExclusive(path, content)) {
    return { ok: true }
  }

  // EEXIST：检查现有锁是真活着还是僵尸
  let existing: LockFile
  try {
    const raw = await fs.readFile(path, 'utf8')
    existing = JSON.parse(raw) as LockFile
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      // 边界情况：刚才 EEXIST，现在又没了（另一个进程释放了）。重试一次 EXCL。
      if (await writeLockExclusive(path, content)) return { ok: true }
      throw new Error('无法稳定获取工程锁，请稍后重试')
    }
    throw new Error(`无法读取工程锁：${e.message}`)
  }

  if (existing.pid !== process.pid && isProcessAlive(existing.pid)) {
    return { ok: false, reason: 'busy', heldBy: existing }
  }

  // 僵尸锁或自己的旧锁：unlink 后再 EXCL 创建一次。
  // 不直接 writeFile 覆盖是为了保留 EXCL 的「最后一道并发屏障」：万一在
  // unlink 与 open 之间另一个进程闪过，它能拿到锁，我们 EEXIST 后再走
  // 一遍探活流程
  await fs.unlink(path).catch(() => {
    /* 已经被别人清掉就更好 */
  })
  if (await writeLockExclusive(path, content)) {
    return { ok: true }
  }

  // 又被抢了：再读一次最终判定
  try {
    const raw = await fs.readFile(path, 'utf8')
    const winner = JSON.parse(raw) as LockFile
    if (winner.pid === process.pid) return { ok: true }
    return { ok: false, reason: 'busy', heldBy: winner }
  } catch {
    throw new Error('工程锁竞争失败')
  }
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
