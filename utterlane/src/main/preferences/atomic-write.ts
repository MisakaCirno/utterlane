import { promises as fs } from 'fs'
import { dirname } from 'path'

/**
 * 原子写入 JSON 文件：先写临时文件，再 rename 覆盖目标。
 *
 * 为什么这样做：
 *   直接 writeFile 时如果进程在写一半崩溃，目标文件会变成半截内容，
 *   启动时解析失败就等于丢数据。rename 在同文件系统内是原子操作，
 *   要么目标是旧内容，要么是完整新内容，不会出现中间状态。
 *
 * tmp 文件带 PID 后缀，避免多实例（比如同时启动两个 Utterlane）互相覆盖临时文件。
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, path)
}
