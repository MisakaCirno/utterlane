import i18n from '@renderer/i18n'
import { showError, showSuccess } from '@renderer/store/toastStore'

/**
 * 导出动作的 renderer 侧编排。封装 IPC + 结果反馈，
 * 让菜单 / 按钮只关心「用户意图」而不用拼错误提示文案。
 */

export async function exportAudioWav(): Promise<void> {
  const result = await window.api.export.audioWav()
  handle(result, i18n.t('export.kind_wav'))
}

export async function exportSubtitlesSrt(): Promise<void> {
  const result = await window.api.export.subtitlesSrt()
  handle(result, i18n.t('export.kind_srt'))
}

function handle(
  result: Awaited<ReturnType<typeof window.api.export.audioWav>>,
  kind: string
): void {
  if (result.ok) {
    const note =
      result.skipped > 0 ? i18n.t('export.skipped_count', { count: result.skipped }) : undefined
    showSuccess(
      i18n.t('export.success_title', { kind }),
      note ? `${note}\n${result.filePath}` : result.filePath
    )
    return
  }
  if (result.canceled) return // 用户主动取消不打扰
  showError(i18n.t('export.failure_title', { kind }), result.message)
}
