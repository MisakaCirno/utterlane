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
      '工程已被占用',
      `已在另一个窗口中打开（PID ${result.heldByPid}）。请先关闭那个窗口后再试。`
    )
    return
  }
  // invalid / canceled 共用这个分支。取消没有用户可感知的 message，就静默。
  if (result.message !== '已取消') {
    reportError('无法打开工程', result.message)
  }
}
