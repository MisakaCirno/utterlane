import { join } from 'path'

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
