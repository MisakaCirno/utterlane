import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ExportAudioOptions } from '@shared/export'
import type { Segment } from '@shared/project'
import { EXPORT_IPC } from '@shared/ipc'
import { projectSession } from '../project-storage'

export { EXPORT_IPC }
import { loadSegmentsFile, loadProjectFile } from '../project-storage/io'
import { readWav, decodeWavToFloat32, buildWavFromChannels } from './wav'
import { resampleChannels } from './resample'
import { concatWithVariableGaps, normalizePeak, normalizePeakAcrossItems } from './post-processing'
import { buildSrt } from './srt'

/**
 * 导出流程（docs/utterlane.md#导出规则）：
 *   - 按 segments.order 遍历
 *   - 只取每个 Segment 的 selectedTakeId 对应的 Take
 *   - 没有 selectedTakeId 的 Segment 跳过（预检时提示用户）
 *
 * 音频导出选项：
 *   - sampleRate / format（pcm16 / pcm24 / float32）：用户在 ExportDialog 选择
 *   - mode = 'concat'：所有 Take 拼成一个 WAV
 *   - mode = 'split'：每个 Take 单独一个 WAV，文件名 `<index>_<text>.wav`
 *
 * 字幕导出独立于音频，不接收选项；时间轴用累积 durationMs 生成（不受重采样影响）。
 *
 * 导出前检查：
 *   - 至少存在一个可导出 Segment
 *   - 缺失 Take 文件（segments.json 引用但磁盘没有）时拒绝并告知
 *   - Take 文件之间 sampleRate / channels / bitsPerSample 必须一致
 *     （这是「单一工程内所有录音参数一致」这一约束的延伸；source 端不一致
 *     不在 MVP 处理范围）
 */

export type ExportResult =
  | { ok: true; filePath: string; skipped: number }
  | { ok: false; message: string; canceled?: boolean }

type SegmentExportItem = {
  /** 在 segments.order 中的 0-based 下标，用于拆分模式生成文件名 */
  index: number
  segment: Segment
  /** Take 的绝对文件路径 */
  filePath: string
}

async function getExportItems(projectDir: string): Promise<{
  items: SegmentExportItem[]
  skipped: number
  projectTitle: string
}> {
  const projectFile = await loadProjectFile(projectDir)
  const segments = await loadSegmentsFile(projectDir)

  const items: SegmentExportItem[] = []
  let skipped = 0
  for (let i = 0; i < segments.order.length; i++) {
    const segId = segments.order[i]
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
    items.push({
      index: i,
      segment: seg,
      filePath: join(projectDir, take.filePath)
    })
  }
  return { items, skipped, projectTitle: projectFile.title }
}

/**
 * 拆分模式下的文件名生成。规则：
 *   - 前缀 3 位序号（按 segments.order 1-based）
 *   - 跟一段从 segment.text 提取的安全字符串，最多 20 个字符
 *   - 去掉文件系统不允许的字符（< > : " / \ | ? *）和控制字符
 *   - 中间空白合并成单个下划线
 *   - 抽完是空的话退化成 `segment`
 */
// 文件系统不允许的字符 + ASCII 控制字符；放到外层是为了让 eslint-disable
// 注释紧贴 regex 字面量，避免 prettier 把 disable 注释和实际行分开
// eslint-disable-next-line no-control-regex
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g

function makeSplitFileName(index: number, text: string): string {
  const orderNum = String(index + 1).padStart(3, '0')
  const sanitized = text
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 20)
  const tail = sanitized.length > 0 ? sanitized : 'segment'
  return `${orderNum}_${tail}.wav`
}

/**
 * 把一组 Take WAV 文件读出来 → 解码 → 按需重采样，返回每段对应的 Float32 多声道
 * 数组。在这一步统一好采样率，下游无论是拼接还是拆分写盘都用同一份数据。
 *
 * 抛错的几种场景：
 *   - 任何文件的 channels / sampleRate / bitsPerSample 与第一份不一致
 *   - 任何文件读取失败
 */
async function decodeAndResampleAll(
  items: SegmentExportItem[],
  targetRate: number
): Promise<{
  perItemChannels: Float32Array[][]
  channels: number
}> {
  const infos = await Promise.all(items.map((it) => readWav(it.filePath)))
  const ref = infos[0]
  for (let i = 1; i < infos.length; i++) {
    const info = infos[i]
    if (
      info.sampleRate !== ref.sampleRate ||
      info.channels !== ref.channels ||
      info.bitsPerSample !== ref.bitsPerSample ||
      info.formatCode !== ref.formatCode
    ) {
      throw new Error(
        `Take 之间音频参数不一致（${basename(items[i].filePath)} 与 ${basename(items[0].filePath)}）。需要先统一工程设置或重录。`
      )
    }
  }

  // 解码每份 WAV 到 Float32 deinterleaved
  const decoded = infos.map(decodeWavToFloat32)
  // 按需重采样：源 rate 与目标 rate 一致时 resampleChannels 会原样返回
  const perItemChannels = decoded.map((channels) =>
    resampleChannels(channels, ref.sampleRate, targetRate)
  )
  return { perItemChannels, channels: ref.channels }
}

export function registerExportIpc(): void {
  ipcMain.handle(
    EXPORT_IPC.audioWav,
    async (event, options: ExportAudioOptions): Promise<ExportResult> => {
      const projectDir = projectSession.path
      if (!projectDir) return { ok: false, message: '没有活动工程' }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) return { ok: false, message: '找不到窗口' }

      const { items, skipped, projectTitle } = await getExportItems(projectDir)
      if (items.length === 0) {
        return { ok: false, message: '没有可导出的 Segment（全部未录制或 Take 丢失）' }
      }

      // 拼接模式弹文件保存对话框；拆分模式弹文件夹选择对话框
      let outputPath: string
      if (options.mode === 'concat') {
        const save = await dialog.showSaveDialog(parent, {
          title: '导出音频',
          defaultPath: `${projectTitle}.wav`,
          filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
        })
        if (save.canceled || !save.filePath) {
          return { ok: false, message: '已取消', canceled: true }
        }
        outputPath = save.filePath
      } else {
        const pick = await dialog.showOpenDialog(parent, {
          title: '选择拆分输出目录',
          properties: ['openDirectory', 'createDirectory'],
          defaultPath: projectDir
        })
        if (pick.canceled || pick.filePaths.length === 0) {
          return { ok: false, message: '已取消', canceled: true }
        }
        outputPath = pick.filePaths[0]
      }

      // 解码 + 重采样统一到目标 rate；任一步失败直接抛错
      let prepared: { perItemChannels: Float32Array[][]; channels: number }
      try {
        prepared = await decodeAndResampleAll(items, options.sampleRate)
      } catch (err) {
        return { ok: false, message: (err as Error).message }
      }

      const silenceMs = options.effects?.silencePaddingMs ?? 0
      const peakDb = options.effects?.peakNormalizeDb

      try {
        if (options.mode === 'concat') {
          // 拼接模式：每段之后的间隔取 segment.gapAfter.ms ?? 全局 silenceMs。
          // gap[i] 是段 i 之后的间隔；最后一段的 gap 被 concatWithVariableGaps
          // 自动忽略。归一化放在 concat 之后是因为目标是「整个工程峰值」
          const gaps = items.map((it, i) => {
            if (i === items.length - 1) return 0
            return it.segment.gapAfter?.ms ?? silenceMs
          })
          const merged = concatWithVariableGaps(
            prepared.perItemChannels,
            prepared.channels,
            options.sampleRate,
            gaps
          )
          if (peakDb !== undefined) normalizePeak(merged, peakDb)

          const wav = buildWavFromChannels({
            sampleRate: options.sampleRate,
            format: options.format,
            channels: merged
          })
          await fs.writeFile(outputPath, wav)
          return { ok: true, filePath: outputPath, skipped }
        } else {
          // 拆分模式：silence 不生效（各段独立文件没有段间概念），但峰值归一
          // 必须用「所有段统一 gain」，否则各段独立归一会让响度相对关系丢失
          if (peakDb !== undefined) {
            normalizePeakAcrossItems(prepared.perItemChannels, peakDb)
          }

          for (let i = 0; i < items.length; i++) {
            const item = items[i]
            const wav = buildWavFromChannels({
              sampleRate: options.sampleRate,
              format: options.format,
              channels: prepared.perItemChannels[i]
            })
            const fileName = makeSplitFileName(item.index, item.segment.text)
            await fs.writeFile(join(outputPath, fileName), wav)
          }
          return { ok: true, filePath: outputPath, skipped }
        }
      } catch (err) {
        return { ok: false, message: `写入文件失败：${(err as Error).message}` }
      }
    }
  )

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
    const withBom = '﻿' + content
    await fs.writeFile(save.filePath, withBom, 'utf8')

    // skipped 数量：未选中 Take 的段数
    const skipped = segments.order.filter((id) => !segments.segmentsById[id]?.selectedTakeId).length
    return { ok: true, filePath: save.filePath, skipped }
  })
}
