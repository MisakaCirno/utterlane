import { promises as fs } from 'fs'
import { join } from 'path'
import { ipcMain } from 'electron'
import type { WriteTakeResult } from '@shared/recording'
import { RECORDING_IPC } from '@shared/ipc'
import { projectSession } from '../project-storage'
import { projectPaths } from '../project-storage/paths'

export { RECORDING_IPC }

/**
 * 录音的落盘流程（对应 docs/utterlane.md#录音落盘）：
 *   1. renderer 录完一段 WAV，把 buffer 通过 IPC 发过来
 *   2. main 先写进 temp/<takeId>.wav（同目录 rename 才是原子）
 *   3. rename 到 audios/<segmentId>/<takeId>.wav
 *   4. 返回最终文件路径（相对路径）给 renderer，renderer 再把 Take 加进 segments.json
 *
 * 这里只处理「文件写入」，Take 对 segments.json 的添加 / 选中由 renderer 侧
 * 通过既有的 saveSegments 流程完成——保持各自职责单一。
 */

export type WriteTakePayload = {
  segmentId: string
  takeId: string
  /** WAV 文件的完整字节（含 RIFF 头） */
  buffer: ArrayBuffer
}

export function registerRecordingIpc(): void {
  ipcMain.handle(
    RECORDING_IPC.writeTake,
    async (_e, payload: WriteTakePayload): Promise<WriteTakeResult> => {
      const projectDir = projectSession.path
      if (!projectDir) {
        return { ok: false, message: '没有活动工程' }
      }

      const paths = projectPaths(projectDir)
      const tempFile = join(paths.tempDir, `${payload.takeId}.wav`)
      const segmentDir = join(paths.audiosDir, payload.segmentId)
      const finalFile = join(segmentDir, `${payload.takeId}.wav`)

      try {
        await fs.mkdir(paths.tempDir, { recursive: true })
        await fs.mkdir(segmentDir, { recursive: true })
        // 先写 temp，再 rename 到正式路径：与 JSON 原子写的思路一致——
        // 失败情况下留在 temp 会被启动时的 temp 清理流程回收（见数据完整性章节）。
        await fs.writeFile(tempFile, Buffer.from(payload.buffer))
        await fs.rename(tempFile, finalFile)
        // 返回相对路径，方便 renderer 直接塞进 Take.filePath
        const relative = `audios/${payload.segmentId}/${payload.takeId}.wav`
        return { ok: true, filePath: relative }
      } catch (err) {
        // 失败时尽量把 temp 清掉，避免累积垃圾
        await fs.unlink(tempFile).catch(() => {})
        return { ok: false, message: (err as Error).message }
      }
    }
  )
}
