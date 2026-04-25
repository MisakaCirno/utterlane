import * as recorder from '@renderer/services/recorder'
import { showError } from '@renderer/store/toastStore'
import { alert as alertDialog } from '@renderer/store/confirmStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import i18n from '@renderer/i18n'
import type { EditorActions, EditorState, SliceCreator } from './types'
import { markDirty, scheduleSegmentsSave } from './save'

/**
 * 录音 slice。
 *
 * 状态机：idle → countdown(N秒) → recording → idle。
 *   - record 键 / 工具栏录音按钮：起 startRecordingForSelected，新 takeId
 *   - rerecord：起 startRerecordingSelected，沿用当前 selectedTakeId 让
 *     writeTake 覆盖同名文件
 *   - stopRecordingAndSave：停止录音 → main 写盘 → 更新 segments.json
 *   - cancelRecording / cancelCountdown：丢弃当前会话
 *
 * 不进 undo 栈：录音有文件系统副作用（写 WAV），undo 无法真正回滚原状态。
 * 用户撤销录音的正确路径是 deleteTake（在 segments slice，进栈，revert 时
 * Take 引用恢复，磁盘文件原本就还在）。
 */

// ---------------------------------------------------------------------------
// 录音流程内部辅助：可选 countdown 阶段 + 真正开录。
//
// 写在模块作用域而不是塞进 action 闭包，是因为这套流程被两个 action
// （新录 / 重录）共用，逻辑唯一区别只是 takeId 来源
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 共用的「（可选倒计时 →）开录」流程。
 *
 * 需要 store 的 setState / getState 来在 sleep 期间检测取消、推进 playback
 * 状态——通过传参得到，避免循环 import。
 */
async function beginRecordingFlow(
  segmentId: string,
  takeId: string,
  channels: 1 | 2,
  setState: (patch: Partial<EditorState>) => void,
  getState: () => EditorState
): Promise<void> {
  // 从 preferences 取倒计时秒数与输入设备。两者都可能不存在——倒计时回落 0
  // （= 关闭），deviceId 回落 undefined（= 系统默认设备）
  const recordingPrefs = usePreferencesStore.getState().prefs.recording
  const countdownSeconds = recordingPrefs?.countdownSeconds ?? 0
  const deviceId = recordingPrefs?.inputDeviceId

  if (countdownSeconds > 0) {
    setState({
      playback: 'countdown',
      countdownRemaining: countdownSeconds,
      recordingSegmentId: segmentId,
      recordingTakeId: takeId
    })

    for (let n = countdownSeconds; n > 0; n--) {
      setState({ countdownRemaining: n })
      await sleep(1000)
      // sleep 期间用户可能按 Esc 触发了 cancelCountdown 把 playback 切到 idle，
      // 检测到就退出
      if (getState().playback !== 'countdown') return
    }
  }

  // 进入正式录音
  setState({
    playback: 'recording',
    countdownRemaining: 0,
    recordingSegmentId: segmentId,
    recordingTakeId: takeId
  })

  try {
    await recorder.startRecording({ channels, deviceId })
  } catch (err) {
    setState({
      playback: 'idle',
      recordingSegmentId: null,
      recordingTakeId: null
    })
    // OverconstrainedError 通常意味着用户偏好里存的 deviceId 已经不在场
    // （设备被拔了 / 改名了 / 驱动重置）。给一条更明确的提示让用户去重选
    const e = err as Error
    const isDeviceMissing = e.name === 'OverconstrainedError' || e.name === 'NotFoundError'
    showError(
      i18n.t('errors.recording_start_title'),
      isDeviceMissing ? i18n.t('errors.recording_device_missing') : e.message
    )
  }
}

// ---------------------------------------------------------------------------
// slice
// ---------------------------------------------------------------------------

export const createRecordingSlice: SliceCreator<
  Pick<
    EditorActions,
    | 'startRecordingForSelected'
    | 'startRerecordingSelected'
    | 'stopRecordingAndSave'
    | 'cancelRecording'
    | 'cancelCountdown'
  >
> = (set, get) => {
  // beginRecordingFlow 需要 setState / getState 形式，store 给的 set 原型已经
  // 兼容（接受 Partial<EditorState>），直接转交即可
  const setState: (patch: Partial<EditorState>) => void = (patch) => set(patch)

  return {
    /**
     * 对当前选中 Segment 新增一个 Take。
     * 要求：有活动工程 + 选中了某个 Segment + 当前不在录音 / 播放中。
     * 倒计时开启（preferences.recording.countdownSeconds > 0）时先走 N 秒
     * countdown 阶段，期间用户按 Esc 或点击 overlay 都会取消并回到 idle。
     */
    startRecordingForSelected: async () => {
      const state = get()
      if (!state.project || !state.selectedSegmentId) return
      if (state.playback !== 'idle') return
      await beginRecordingFlow(
        state.selectedSegmentId,
        crypto.randomUUID(),
        state.project.audio.channels,
        setState,
        get
      )
    },

    /**
     * 重录：沿用当前选中 Take 的 ID，录完后 writeTake 会原子覆盖同名文件，
     * 新的 durationMs 会替换原记录，selectedTakeId 不变。
     */
    startRerecordingSelected: async () => {
      const state = get()
      if (!state.project || !state.selectedSegmentId) return
      if (state.playback !== 'idle') return
      const seg = state.segmentsById[state.selectedSegmentId]
      if (!seg?.selectedTakeId) return
      // 复用同 takeId → writeTake 会覆盖同名文件
      await beginRecordingFlow(
        state.selectedSegmentId,
        seg.selectedTakeId,
        state.project.audio.channels,
        setState,
        get
      )
    },

    cancelCountdown: () => {
      const state = get()
      if (state.playback !== 'countdown') return
      // 直接回 idle，等待 beginRecordingFlow 内部的循环检测到状态变化后退出。
      // 不需要主动 reject 任何 Promise——sleep 自然走完，sleep 后第一句
      // get().playback 检查就 return 了
      set({
        playback: 'idle',
        countdownRemaining: 0,
        recordingSegmentId: null,
        recordingTakeId: null
      })
    },

    stopRecordingAndSave: async () => {
      const state = get()
      if (state.playback !== 'recording') return
      const segmentId = state.recordingSegmentId
      const takeId = state.recordingTakeId
      if (!segmentId || !takeId) return

      let result: { buffer: ArrayBuffer; durationMs: number }
      try {
        result = await recorder.stopRecording()
      } catch (err) {
        set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
        // 录音失败用强模态 alert：toast 一闪就过用户可能看不到，下次回放才发现
        // 录音没保存。alert 必须用户点 OK 才消失，确保 acknowledge
        void alertDialog({
          title: i18n.t('errors.recording_stop_title'),
          description: i18n.t('errors.recording_stop_description', {
            message: (err as Error).message
          }),
          tone: 'danger'
        })
        return
      }

      const writeRes = await window.api.recording.writeTake(segmentId, takeId, result.buffer)
      if (!writeRes.ok) {
        set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
        void alertDialog({
          title: i18n.t('errors.recording_persist_title'),
          description: i18n.t('errors.recording_persist_description', {
            message: writeRes.message
          }),
          tone: 'danger'
        })
        return
      }

      // 写盘成功后更新 segments：
      //   - 如果 takeId 在 takes 里已经存在 → 重录：原地替换 filePath /
      //     durationMs（文件已被覆盖）；trim 字段一并清掉，因为新录音的
      //     时长可能与旧 take 不同，旧 trim 越界毫无意义。selectedTakeId
      //     不变
      //   - 否则 → 新录：追加 Take（无 trim 字段），selectedTakeId 指向它
      set((s: EditorState) => {
        const seg = s.segmentsById[segmentId]
        if (!seg) return s
        const existingIdx = seg.takes.findIndex((t) => t.id === takeId)
        if (existingIdx >= 0) {
          const nextTakes = seg.takes.slice()
          // 重录：保留 id，filePath / durationMs 用新值，trim 字段彻底删除
          // （不能 spread 旧 take 后只设新字段，否则 trimStartMs / trimEndMs
          // 会被原样保留）
          nextTakes[existingIdx] = {
            id: nextTakes[existingIdx].id,
            filePath: writeRes.filePath,
            durationMs: result.durationMs
          }
          return {
            segmentsById: { ...s.segmentsById, [segmentId]: { ...seg, takes: nextTakes } },
            playback: 'idle',
            recordingSegmentId: null,
            recordingTakeId: null,
            ...markDirty()
          }
        }
        return {
          segmentsById: {
            ...s.segmentsById,
            [segmentId]: {
              ...seg,
              takes: [
                ...seg.takes,
                { id: takeId, filePath: writeRes.filePath, durationMs: result.durationMs }
              ],
              selectedTakeId: takeId
            }
          },
          playback: 'idle',
          recordingSegmentId: null,
          recordingTakeId: null,
          ...markDirty()
        }
      })
      scheduleSegmentsSave()
    },

    cancelRecording: async () => {
      const state = get()
      if (state.playback !== 'recording') return
      await recorder.cancelRecording().catch(() => {})
      set({ playback: 'idle', recordingSegmentId: null, recordingTakeId: null })
    }
  }
}
