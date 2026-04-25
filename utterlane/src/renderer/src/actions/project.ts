import i18n from '@renderer/i18n'
import { useEditorStore } from '@renderer/store/editorStore'
import { showError } from '@renderer/store/toastStore'

/**
 * Project 生命周期的 renderer 侧编排。
 *
 * 这些函数封装「调 IPC → 看结果 → 更新 store / 给用户反馈」的完整流程，
 * 让调用方（菜单、欢迎页、快捷键 handler）只关心「用户意图」而不用关心 IPC 协议。
 */

function reportError(title: string, description?: string): void {
  console.error('[project-action]', title, description ?? '')
  showError(title, description)
}

export async function newProject(): Promise<void> {
  const result = await window.api.project.new()
  handleOpenResult(result)
}

export async function openProject(): Promise<void> {
  const result = await window.api.project.open()
  handleOpenResult(result)
}

export async function openProjectPath(path: string): Promise<void> {
  const result = await window.api.project.openPath(path)
  handleOpenResult(result)
}

export async function closeCurrentProject(): Promise<void> {
  await window.api.project.close()
  useEditorStore.getState().clear()
}

// ---------------------------------------------------------------------------

function handleOpenResult(result: Awaited<ReturnType<typeof window.api.project.open>>): void {
  if (result.ok) {
    useEditorStore.getState().applyBundle(result.bundle)
    return
  }
  if (result.reason === 'busy') {
    reportError(
      i18n.t('errors.project_busy_title'),
      i18n.t('errors.project_busy_description', { pid: result.heldByPid })
    )
    return
  }
  // 用户主动取消（对话框关闭）不弹错误。只看 canceled flag，避免和翻译
  // 后的 message 字面量耦合——main 返回的 '已取消' 在英文环境下也是中文，
  // 之前用 string 比对会在 i18n 切换时漏掉
  if (result.canceled) return
  reportError(i18n.t('errors.open_project_title'), result.message)
}
