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
  // invalid / canceled 共用这个分支。取消没有用户可感知的 message，就静默。
  // '已取消' / 'Cancelled' 都是 main 侧返回的字面量；canceled flag 的判断应该优先，
  // 但为了兼容旧逻辑这里仍然做一次文本比较
  if (result.message !== '已取消' && result.message !== 'Cancelled') {
    reportError(i18n.t('errors.open_project_title'), result.message)
  }
}
