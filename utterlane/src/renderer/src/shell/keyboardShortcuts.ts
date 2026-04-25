import { useEditorStore } from '@renderer/store/editorStore'
import { useDialogStore } from '@renderer/store/dialogStore'
import { useHistoryStore } from '@renderer/store/historyStore'
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

    // Ctrl/Cmd + , 打开偏好设置。遵循 macOS / VSCode 传统键位
    if (mod && e.key === ',') {
      e.preventDefault()
      useDialogStore.getState().openPreferences()
      return
    }

    if (!hasProject) return

    // Ctrl/Cmd+Z: undo；Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y: redo。
    // historyStore 的 undo / redo 内部会检查 playback === 'idle'，
    // 录音 / 播放中按下会被 no-op 掉，但 preventDefault 仍然生效，
    // 免得浏览器原生回退（例如某些控件的 Ctrl+Z）干扰用户。
    // 焦点在 input / textarea 时上面的 isEditableTarget 已经直接 return，
    // 所以文本框里的 Ctrl+Z 仍然走原生编辑历史
    if (mod && e.key.toLowerCase() === 'z' && !e.altKey) {
      e.preventDefault()
      if (e.shiftKey) useHistoryStore.getState().redo()
      else useHistoryStore.getState().undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'y' && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      useHistoryStore.getState().redo()
      return
    }

    // Esc 优先级：倒计时 > 录音 > 播放 > 多选副选 > （idle 时无操作）。
    // 多选副选清空放最后是因为它是「无副作用的视觉收敛」，应该让位给
    // 录音播放这种「真要中止某个会话」的更高优先级动作
    if (e.key === 'Escape') {
      if (state.playback === 'countdown') {
        e.preventDefault()
        state.cancelCountdown()
      } else if (state.playback === 'recording') {
        e.preventDefault()
        void state.cancelRecording()
      } else if (state.playback === 'segment' || state.playback === 'project') {
        e.preventDefault()
        state.stopPlayback()
      } else if (state.extraSelectedSegmentIds.size > 0) {
        e.preventDefault()
        state.clearExtraSelection()
      }
      return
    }

    // Space：DAW 式 toggle。idle → 播当前句；播放中 → 暂停 / 继续
    // Shift+Space：同样的逻辑作用于项目连读
    if (e.key === ' ' && !mod && !e.altKey) {
      e.preventDefault()
      if (state.playback === 'segment' || state.playback === 'project') {
        state.togglePausePlayback()
      } else if (state.playback === 'idle') {
        if (e.shiftKey) void state.playProject()
        else void state.playCurrentSegment()
      }
      return
    }

    // Arrow Up / Down：在 Segments 列表里上下导航（录音 / 播放期间禁用）
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod && !e.altKey && !e.shiftKey) {
      if (state.playback !== 'idle') return
      const idx = state.selectedSegmentId ? state.order.indexOf(state.selectedSegmentId) : -1
      const next =
        e.key === 'ArrowUp' ? Math.max(0, idx - 1) : Math.min(state.order.length - 1, idx + 1)
      if (next !== idx && state.order[next]) {
        e.preventDefault()
        state.selectSegment(state.order[next])
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
