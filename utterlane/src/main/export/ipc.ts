import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { projectSession } from '../project-storage'
import { loadSegmentsFile, loadProjectFile } from '../project-storage/io'
import { readWav, writeWav } from './wav'
import { buildSrt } from './srt'

/**
 * 导出流程（docs/utterlane.md#导出规则）：
 *   - 按 segments.order 遍历
 *   - 只取每个 Segment 的 selectedTakeId 对应的 Take
 *   - 没有 selectedTakeId 的 Segment 跳过（预检时提示用户）
 *   - 音频：把所有选中 Take 的 WAV 拼成一个 WAV
 *   - 字幕：按累积 durationMs 生成 SRT
 *
 * 导出前检查：
 *   - 至少存在一个可导出 Segment
 *   - 缺失 Take 文件（segments.json 引用但磁盘没有）时拒绝并告知
 *   - Take 文件之间 sampleRate / channels / bitsPerSample 必须一致
 */

export const EXPORT_IPC = {
  audioWav: 'export:audio-wav',
  subtitlesSrt: 'export:subtitles-srt'
} as const

export type ExportResult =
  | { ok: true; filePath: string; skipped: number }
  | { ok: false; message: string; canceled?: boolean }

async function getTakeFilesInOrder(
  projectDir: string
): Promise<{ files: string[]; skipped: number; projectTitle: string }> {
  const projectFile = await loadProjectFile(projectDir)
  const segments = await loadSegmentsFile(projectDir)

  const files: string[] = []
  let skipped = 0
  for (const segId of segments.order) {
    const seg = segments.segmentsById[segId]
    if (!seg?.selectedTakeId) {
      skipped++
      continue
    }
    const take = seg.takes.find((t) => t.id === seg.selectedTakeId)
    if (!take) {
      skipped++
      continue
    }
    // Take.filePath 是工程相对路径
    files.push(join(projectDir, take.filePath))
  }
  return { files, skipped, projectTitle: projectFile.title }
}

export function registerExportIpc(): void {
  ipcMain.handle(EXPORT_IPC.audioWav, async (event): Promise<ExportResult> => {
    const projectDir = projectSession.path
    if (!projectDir) return { ok: false, message: '没有活动工程' }
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) return { ok: false, message: '找不到窗口' }

    const { files, skipped, projectTitle } = await getTakeFilesInOrder(projectDir)
    if (files.length === 0) {
      return { ok: false, message: '没有可导出的 Segment（全部未录制或 Take 丢失）' }
    }

    const save = await dialog.showSaveDialog(parent, {
      title: '导出音频',
      defaultPath: `${projectTitle}.wav`,
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
    })
    if (save.canceled || !save.filePath) return { ok: false, message: '已取消', canceled: true }

    // 读所有 WAV，顺便校验参数一致性
    const infos = await Promise.all(files.map((f) => readWav(f)))
    const ref = infos[0]
    for (let i = 1; i < infos.length; i++) {
      const info = infos[i]
      if (
        info.sampleRate !== ref.sampleRate ||
        info.channels !== ref.channels ||
        info.bitsPerSample !== ref.bitsPerSample
      ) {
        return {
          ok: false,
          message: `Take 之间音频参数不一致（${basename(files[i])} 与 ${basename(files[0])}）。需要先统一工程设置或重录。`
        }
      }
    }

    const merged = writeWav({
      sampleRate: ref.sampleRate,
      channels: ref.channels,
      bitsPerSample: ref.bitsPerSample,
      pcmSegments: infos.map((i) => i.pcm)
    })
    await fs.writeFile(save.filePath, merged)

    return { ok: true, filePath: save.filePath, skipped }
  })

  ipcMain.handle(EXPORT_IPC.subtitlesSrt, async (event): Promise<ExportResult> => {
    const projectDir = projectSession.path
    if (!projectDir) return { ok: false, message: '没有活动工程' }
    const parent = BrowserWindow.fromWebContents(event.sender)
    if (!parent) return { ok: false, message: '找不到窗口' }

    const segments = await loadSegmentsFile(projectDir)
    const projectFile = await loadProjectFile(projectDir)

    // 先做一次快速检查：缺失 Take 文件不阻塞字幕导出（字幕只用 durationMs），
    // 但如果没有任何可用条目就别导一个空文件出来
    const hasAny = segments.order.some((id) => {
      const seg = segments.segmentsById[id]
      return !!seg?.selectedTakeId
    })
    if (!hasAny) {
      return { ok: false, message: '没有可导出的 Segment（全部未选择 Take）' }
    }

    const save = await dialog.showSaveDialog(parent, {
      title: '导出字幕',
      defaultPath: `${projectFile.title}.srt`,
      filters: [{ name: 'SubRip', extensions: ['srt'] }]
    })
    if (save.canceled || !save.filePath) return { ok: false, message: '已取消', canceled: true }

    const content = buildSrt(segments)
    // UTF-8 with BOM 能让部分播放器 / 编辑器更好地识别；BOM 不会影响正常 SRT 解析
    const withBom = '\uFEFF' + content
    await fs.writeFile(save.filePath, withBom, 'utf8')

    // skipped 数量：未选中 Take 的段数
    const skipped = segments.order.filter((id) => !segments.segmentsById[id]?.selectedTakeId).length
    return { ok: true, filePath: save.filePath, skipped }
  })
}
