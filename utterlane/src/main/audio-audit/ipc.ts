import { promises as fs } from 'fs'
import { join, relative, sep } from 'path'
import { randomUUID } from 'crypto'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  AuditScanResult,
  DeleteOrphanResult,
  MissingTake,
  OrphanFile,
  RemapTakeResult,
  SaveOrphanAsTakeResult
} from '@shared/audio-audit'
import { AUDIO_AUDIT_IPC } from '@shared/ipc'
import { projectSession } from '../project-storage'
import { loadSegmentsFile } from '../project-storage/io'
import { projectPaths, resolveProjectRelative } from '../project-storage/paths'
import { readWav } from '../export/wav'

export { AUDIO_AUDIT_IPC }

/**
 * 音频文件审计：扫描 segments.json 与 audios/ 之间的差异，提供缺失 Take 修复
 * 和孤儿文件清理两套互逆的入口。
 *
 * === 职责切分 ===
 *
 * main 这一侧只做「文件系统操作」：扫目录、复制 / 移动 / 回收站删除。
 * 不直接改 segments.json——所有 segments 字段更新仍走 renderer 的 editorStore，
 * 由它在收到 IPC 结果后调既有的 mutation 路径，最终通过 saveSegments
 * 落盘。这样保持「segments.json 唯一写入源是 editorStore」的不变量，
 * 也避免双源写入导致的窗口期不一致。
 *
 * 短暂的不一致窗口（main 已经动了文件、renderer 还没来得及写 segments.json）
 * 是可接受的：审计本来就是修复工具，下次再扫即可发现差异。
 *
 * === 不进 undo 栈 ===
 *
 * 这些是修复性操作，纳入 undo 反而别扭——撤销了「修复」之后还得手动重新
 * 修复。和录音同样的边界。
 */

// ---------------------------------------------------------------------------
// 扫描：列出缺失 + 孤儿
// ---------------------------------------------------------------------------

/**
 * 递归列出某个目录下所有 .wav 文件，返回相对 baseDir 的路径。
 * 路径分隔符统一成 /，方便跟 segments.json 里的 filePath 字段比对（segments.json
 * 里始终写 / 形式的相对路径，跨平台一致）。
 */
async function listWavFiles(baseDir: string, root: string): Promise<string[]> {
  const out: string[] = []
  let entries: import('fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') return [] // audios/ 还没创建（新工程）
    throw err
  }
  for (const entry of entries) {
    const abs = join(root, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listWavFiles(baseDir, abs)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) {
      out.push(relative(baseDir, abs).split(sep).join('/'))
    }
  }
  return out
}

async function scanProject(projectDir: string): Promise<AuditScanResult> {
  const segments = await loadSegmentsFile(projectDir)
  const paths = projectPaths(projectDir)

  // 期望集合：segments.json 中所有 take.filePath 的相对路径
  const expectedFiles = new Map<string, { segmentId: string; takeId: string }>()
  for (const segId of segments.order) {
    const seg = segments.segmentsById[segId]
    if (!seg) continue
    for (const take of seg.takes) {
      expectedFiles.set(take.filePath, { segmentId: segId, takeId: take.id })
    }
  }

  // 实际集合：audios/ 下所有 .wav
  const actualFiles = await listWavFiles(projectDir, paths.audiosDir)
  const actualSet = new Set(actualFiles)

  // 缺失 = 期望中存在但实际找不到的
  const missing: MissingTake[] = []
  for (let i = 0; i < segments.order.length; i++) {
    const segId = segments.order[i]
    const seg = segments.segmentsById[segId]
    if (!seg) continue
    for (const take of seg.takes) {
      if (!actualSet.has(take.filePath)) {
        missing.push({
          segmentId: segId,
          takeId: take.id,
          expectedPath: take.filePath,
          segmentText: seg.text,
          segmentIndex: i
        })
      }
    }
  }

  // 孤儿 = 实际存在但期望集合没有
  const orphans: OrphanFile[] = []
  for (const rel of actualFiles) {
    if (expectedFiles.has(rel)) continue
    try {
      const stat = await fs.stat(join(projectDir, rel))
      orphans.push({
        relativePath: rel,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs
      })
    } catch {
      // 扫到 stat 时文件被删（用户手动操作）→ 跳过
    }
  }

  return { missing, orphans }
}

// ---------------------------------------------------------------------------
// 解码工具：从 WAV 提取毫秒时长
// ---------------------------------------------------------------------------

async function probeDurationMs(absPath: string): Promise<number> {
  const info = await readWav(absPath)
  const blockAlign = info.channels * (info.bitsPerSample / 8)
  const totalFrames = Math.floor(info.pcm.length / blockAlign)
  return Math.round((totalFrames / info.sampleRate) * 1000)
}

// ---------------------------------------------------------------------------
// IPC 注册
// ---------------------------------------------------------------------------

export function registerAudioAuditIpc(): void {
  ipcMain.handle(AUDIO_AUDIT_IPC.scan, async (): Promise<AuditScanResult> => {
    const projectDir = projectSession.path
    if (!projectDir) return { missing: [], orphans: [] }
    return await scanProject(projectDir)
  })

  // 用户在缺失列表上点「指定 WAV…」：
  // 1. main 弹文件选择对话框
  // 2. 复制选中文件到期望路径 audios/<segId>/<takeId>.wav
  // 3. 解码新文件计算 durationMs
  // 4. 返回 { relativePath, durationMs }，让 renderer 更新 Take.durationMs
  //    （filePath 不会变——expected 路径就是 takeId 决定的那个）
  ipcMain.handle(
    AUDIO_AUDIT_IPC.remap,
    async (event, payload: { segmentId: string; takeId: string }): Promise<RemapTakeResult> => {
      const projectDir = projectSession.path
      if (!projectDir) return { ok: false, message: '没有活动工程' }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) return { ok: false, message: '找不到窗口' }

      const pick = await dialog.showOpenDialog(parent, {
        title: '指定 WAV 文件',
        properties: ['openFile'],
        filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
      })
      if (pick.canceled || pick.filePaths.length === 0) {
        return { ok: false, message: '已取消', canceled: true }
      }

      const sourcePath = pick.filePaths[0]
      const paths = projectPaths(projectDir)
      const segmentDir = join(paths.audiosDir, payload.segmentId)
      const targetAbs = join(segmentDir, `${payload.takeId}.wav`)
      const relativePath = `audios/${payload.segmentId}/${payload.takeId}.wav`

      try {
        await fs.mkdir(segmentDir, { recursive: true })
        // copyFile 而不是 rename：源文件可能在工程目录之外，跨设备 rename 会失败；
        // 即便同设备成功，把用户原始文件搬走也不符合「指定」语义
        await fs.copyFile(sourcePath, targetAbs)
        const durationMs = await probeDurationMs(targetAbs)
        return { ok: true, relativePath, durationMs }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  // 把孤儿 WAV 转入某个 Segment 名下作为新 Take。
  // 用 rename：孤儿本来就在工程内 audios/ 下，同设备 rename 原子又能直接消除
  // 孤儿状态。返回新 takeId 让 renderer 把新 Take 追加进 segmentsById
  ipcMain.handle(
    AUDIO_AUDIT_IPC.saveOrphanAsTake,
    async (
      _event,
      payload: { orphanRelativePath: string; segmentId: string }
    ): Promise<SaveOrphanAsTakeResult> => {
      const projectDir = projectSession.path
      if (!projectDir) return { ok: false, message: '没有活动工程' }

      const newTakeId = randomUUID()
      const paths = projectPaths(projectDir)
      const segmentDir = join(paths.audiosDir, payload.segmentId)
      const targetAbs = join(segmentDir, `${newTakeId}.wav`)
      const newRelativePath = `audios/${payload.segmentId}/${newTakeId}.wav`

      let sourceAbs: string
      try {
        sourceAbs = resolveProjectRelative(projectDir, payload.orphanRelativePath)
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }

      try {
        await fs.mkdir(segmentDir, { recursive: true })
        await fs.rename(sourceAbs, targetAbs)
        const durationMs = await probeDurationMs(targetAbs)
        return {
          ok: true,
          segmentId: payload.segmentId,
          takeId: newTakeId,
          relativePath: newRelativePath,
          durationMs
        }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    AUDIO_AUDIT_IPC.deleteOrphan,
    async (_event, relativePath: string): Promise<DeleteOrphanResult> => {
      const projectDir = projectSession.path
      if (!projectDir) return { ok: false, message: '没有活动工程' }

      let abs: string
      try {
        abs = resolveProjectRelative(projectDir, relativePath)
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
      try {
        // shell.trashItem 把文件送进系统回收站，给用户后悔余地。
        // 平台行为：Windows / macOS 真回收站；Linux 取决于桌面环境
        await shell.trashItem(abs)
        return { ok: true }
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }
    }
  )
}
