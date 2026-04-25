import { useEditorStore } from '@renderer/store/editorStore'
import { useDialogStore } from '@renderer/store/dialogStore'
import { useHistoryStore } from '@renderer/store/historyStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { newProject, openProject } from '@renderer/actions/project'
import { bindingMatches, resolveBindings, type CustomizableActionId } from '@shared/preferences'

/**
 * 在全局安装键盘快捷键。
 *
 * 为什么 keydown 而不是 keyup：录音 / 取消这类动作要立刻响应，
 * 不等到按键抬起。
 *
 * 焦点位于 input / textarea / contenteditable 时跳过所有快捷键，
 * 避免用户打字时误触（比如在 Inspector 文案框里输入 "r" 会开始录音）。
 *
 * === 可定制 vs 不可定制 ===
 *
 * 「OS 约定」类（Ctrl+N 新建 / Ctrl+Z 撤销 / Ctrl+, 偏好等）保持硬编码，
 * 跨应用习惯不应被自定义打破。
 *
 * 「传输 / 导航」类（录音 / 重录 / 播放 / 上下段切换 / 停止）通过
 * preferences.keyboard.bindings 用户自定义，这里通过 resolveBindings
 * 拿到当前生效的绑定表，按 actionId 调用 dispatchAction。
 *
 * 返回 cleanup，给 useEffect 用。
 */
export function installKeyboardShortcuts(): () => void {
  const handler = (e: KeyboardEvent): void => {
    if (isEditableTarget(e.target)) return

    const state = useEditorStore.getState()
    const hasProject = state.project !== null
    const mod = e.ctrlKey || e.metaKey

    // ----- OS 约定（不可自定义） -----

    // Ctrl/Cmd + N / O：新建 / 打开工程
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

    // Ctrl/Cmd + , 打开偏好设置（macOS / VSCode 习惯）
    if (mod && e.key === ',') {
      e.preventDefault()
      useDialogStore.getState().openPreferences()
      return
    }

    if (!hasProject) return

    // Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y：undo / redo
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

    // ----- 可自定义动作：按 preferences 里的绑定派发 -----

    // resolveBindings 拿到的是 actionId → KeyBinding | null。null 表示
    // 用户显式取消了该动作的快捷键，遍历时 continue
    const bindings = resolveBindings(usePreferencesStore.getState().prefs)
    for (const id of Object.keys(bindings) as CustomizableActionId[]) {
      const b = bindings[id]
      if (!b) continue
      if (!bindingMatches(b, e)) continue
      if (dispatchAction(id)) {
        e.preventDefault()
        return
      }
    }
  }

  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

/**
 * 真正执行一个可自定义动作。返回 true 表示该 keypress 已被消费（包括 no-op
 * 的吞键场景，比如非空闲态下按播放键），调用方应 preventDefault 不再继续。
 *
 * 把行为分支留在这里而不是绑定表，是因为多数动作都需要根据 playback 状态
 * 走不同分支（比如 stopOrCancel 在不同状态下行为完全不同），用纯函数而不是
 * 「绑定 → 函数引用」的简单映射更直观
 */
function dispatchAction(id: CustomizableActionId): boolean {
  const state = useEditorStore.getState()

  switch (id) {
    case 'record': {
      // 录音中按 record 视作「停止录音」，否则发起新录
      if (state.playback === 'recording') {
        void state.stopRecordingAndSave()
        return true
      }
      void state.startRecordingForSelected()
      return true
    }
    case 'rerecord': {
      // 录音中按 rerecord 也视作停止；重录默认是覆盖当前 Take，要先有当前 Take
      if (state.playback === 'recording') {
        void state.stopRecordingAndSave()
        return true
      }
      void state.startRerecordingSelected()
      return true
    }
    case 'playSegment': {
      // DAW 习惯：播放中按一下变暂停 / 恢复，空闲中按一下开始播
      if (state.playback === 'segment' || state.playback === 'project') {
        state.togglePausePlayback()
        return true
      }
      if (state.playback === 'idle') {
        void state.playCurrentSegment()
        return true
      }
      // 录音 / 倒计时态：吞键不动，但仍 preventDefault 避免空格被滚到底部
      return true
    }
    case 'playProject': {
      if (state.playback === 'segment' || state.playback === 'project') {
        state.togglePausePlayback()
        return true
      }
      if (state.playback === 'idle') {
        void state.playProject()
        return true
      }
      return true
    }
    case 'prevSegment':
    case 'nextSegment': {
      // 录音 / 播放期间禁用导航，避免和正在进行的会话冲突
      if (state.playback !== 'idle') return false
      const curIdx = state.selectedSegmentId ? state.order.indexOf(state.selectedSegmentId) : -1
      const nextIdx =
        id === 'prevSegment'
          ? Math.max(0, curIdx - 1)
          : Math.min(state.order.length - 1, curIdx + 1)
      if (nextIdx !== curIdx && state.order[nextIdx]) {
        state.selectSegment(state.order[nextIdx])
        return true
      }
      return false
    }
    case 'stopOrCancel': {
      // 复合行为：按当前态决定执行哪一步
      if (state.playback === 'countdown') {
        state.cancelCountdown()
        return true
      }
      if (state.playback === 'recording') {
        void state.cancelRecording()
        return true
      }
      if (state.playback === 'segment' || state.playback === 'project') {
        state.stopPlayback()
        return true
      }
      if (state.extraSelectedSegmentIds.size > 0) {
        state.clearExtraSelection()
        return true
      }
      return false
    }
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
