import { isAbsolute, join, normalize, relative } from 'path'

/**
 * 给定工程目录，推导所有工程内部文件 / 目录的绝对路径。
 * 文件名本身是常量，和 docs/utterlane.md#项目目录结构 保持一致。
 */
export function projectPaths(dir: string): {
  projectFile: string
  segmentsFile: string
  workspaceFile: string
  audiosDir: string
  tempDir: string
  lockFile: string
} {
  return {
    projectFile: join(dir, 'project.json'),
    segmentsFile: join(dir, 'segments.json'),
    workspaceFile: join(dir, 'workspace.json'),
    audiosDir: join(dir, 'audios'),
    tempDir: join(dir, 'temp'),
    lockFile: join(dir, '.utterlane-lock')
  }
}

/**
 * 把 renderer 传来的工程相对路径正规化到工程目录内的绝对路径。
 * 越界（含 `..` 跳出工程目录）或绝对路径都拒绝——renderer 是受信任侧，
 * 但任何接受外部字符串的入口都应当统一边界，避免 future bug 让一个
 * 「保存为 Take」的 payload 删掉用户家目录里的文件。
 *
 * 抛错而不是返回 null：调用点都是 IPC handler，try/catch 会把 message
 * 扔回 renderer 显示，比静默返回更安全。
 */
export function resolveProjectRelative(projectDir: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('路径为空')
  }
  if (isAbsolute(relativePath)) {
    throw new Error('只接受工程相对路径')
  }
  const absolute = normalize(join(projectDir, relativePath))
  // path.relative 如果目标在 base 上层，结果会以 '..' 开头
  const rel = relative(projectDir, absolute)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('路径越界，拒绝访问')
  }
  return absolute
}
