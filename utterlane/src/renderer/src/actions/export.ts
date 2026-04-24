import { showError, showSuccess } from '@renderer/store/toastStore'

/**
 * 导出动作的 renderer 侧编排。封装 IPC + 结果反馈，
 * 让菜单 / 按钮只关心「用户意图」而不用拼错误提示文案。
 */

export async function exportAudioWav(): Promise<void> {
  const result = await window.api.export.audioWav()
  handle(result, 'WAV 音频')
}

export async function exportSubtitlesSrt(): Promise<void> {
  const result = await window.api.export.subtitlesSrt()
  handle(result, 'SRT 字幕')
}

function handle(
  result: Awaited<ReturnType<typeof window.api.export.audioWav>>,
  kind: string
): void {
  if (result.ok) {
    const note = result.skipped > 0 ? `跳过 ${result.skipped} 条未录制段` : undefined
    showSuccess(`${kind}导出成功`, note ? `${note}\n${result.filePath}` : result.filePath)
    return
  }
  if (result.canceled) return // 用户主动取消不打扰
  showError(`${kind}导出失败`, result.message)
}
