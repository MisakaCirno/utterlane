/**
 * 导出动作的 renderer 侧编排。封装 IPC + 结果反馈，
 * 让菜单 / 按钮只关心「用户意图」而不用拼错误提示文案。
 *
 * 反馈目前用原生 alert；后续接入 toast 时只改这里即可。
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
    const note = result.skipped > 0 ? `（跳过 ${result.skipped} 条未录制段）` : ''
    window.alert(`${kind}导出成功：${result.filePath}${note}`)
    return
  }
  if (result.canceled) return // 用户主动取消不打扰
  window.alert(`${kind}导出失败：${result.message}`)
}
