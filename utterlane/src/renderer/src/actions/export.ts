import type { ExportAudioOptions } from '@shared/export'
import i18n from '@renderer/i18n'
import { showError, showSuccess } from '@renderer/store/toastStore'
import { useDialogStore } from '@renderer/store/dialogStore'

/**
 * 导出动作的 renderer 侧编排。封装 IPC + 结果反馈，
 * 让菜单 / 按钮只关心「用户意图」而不用拼错误提示文案。
 *
 * 音频导出走两步：先打开 ExportDialog 让用户选采样率 / 位深 / 拼接 vs 拆分，
 * 用户确认后 ExportDialog 调 runExportAudioWav 触发原生保存对话框 + 实际写盘。
 * SRT 导出无选项可选，直接弹原生保存对话框。
 */

/** 菜单 / 快捷键的入口：打开导出选项对话框 */
export function exportAudioWav(): void {
  useDialogStore.getState().openExportAudio()
}

/** ExportDialog 的「导出」按钮触发：携带用户选择的选项执行 IPC */
export async function runExportAudioWav(options: ExportAudioOptions): Promise<void> {
  const result = await window.api.export.audioWav(options)
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
