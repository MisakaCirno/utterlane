import { useEditorStore } from '@renderer/store/editorStore'
import { newProject, openProject } from '@renderer/actions/project'

/**
 * 在全局安装键盘快捷键。
 *
 * 为什么 keydown 而不是 keyup：录音 / 取消这类动作要立刻响应，
 * 不等到按键抬起。
 *
 * 焦点位于 input / textarea / contenteditable 时跳过所有快捷键，
 * 避免用户打字时误触（比如在 Inspector 文案框里输入 "r" 会开始录音）。
 *
 * 返回 cleanup，给 useEffect 用。
 */
export function installKeyboardShortcuts(): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) return

    const state = useEditorStore.getState()
    const hasProject = state.project !== null
    const mod = e.ctrlKey || e.metaKey

    // Ctrl/Cmd + N / O：新建 / 打开工程（菜单上显示的 shortcut 在这里兑现）
    if (mod && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      void newProject()
      return
    }
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      void openProject()
      return
    }

    if (!hasProject) return

    // Esc：录音中 → 取消录音；否则无操作（未来可加「取消播放」）
    if (e.key === 'Escape') {
      if (state.playback === 'recording') {
        e.preventDefault()
        void state.cancelRecording()
      }
      return
    }

    // R / Shift+R：录音 / 重录；录音中按 R 视作停止录音
    if (e.key.toLowerCase() === 'r' && !mod && !e.altKey) {
      e.preventDefault()
      if (state.playback === 'recording') {
        void state.stopRecordingAndSave()
        return
      }
      if (e.shiftKey) {
        void state.startRerecordingSelected()
      } else {
        void state.startRecordingForSelected()
      }
    }
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
