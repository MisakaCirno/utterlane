import * as player from '@renderer/services/player'
import { showError } from '@renderer/store/toastStore'
import i18n from '@renderer/i18n'
import { takeEffectiveDurationMs, takeEffectiveRange } from '@shared/project'
import type { EditorActions, SliceCreator } from './types'
import { pushWorkspace } from './save'

/**
 * 播放倍速允许的边界。0.25x 接近极限慢放仍能听清相位；4x 接近大多数人
 * 一边听还能跟上的极速浏览。低于 / 高于这个区间会让用户体验奇怪
 */
const PLAYBACK_RATE_MIN = 0.25
const PLAYBACK_RATE_MAX = 4

/**
 * 可暂停 / 可取消的等待。RAF 里累加 elapsed,paused 时不累加 wall-clock,
 * 让暂停期间「停表」——避免「暂停 = 仍在等」让 gap 不公平。倍速由调用
 * 方在传入 ms 时已经除掉,所以这里只看真实毫秒
 */
function sleepPausable(
  ms: number,
  isCancelled: () => boolean,
  isPaused: () => boolean
): Promise<void> {
  return new Promise((resolve) => {
    let elapsed = 0
    let last = performance.now()
    function tick(): void {
      if (isCancelled()) {
        resolve()
        return
      }
      const now = performance.now()
      const delta = now - last
      last = now
      if (!isPaused()) elapsed += delta
      if (elapsed >= ms) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

/**
 * 播放 slice：单段试听 / 工程连读 / 停止 / 暂停。
 *
 * === 全局单实例不变量 ===
 *
 * App 任意时刻最多只有一个播放任务在跑——不管发起方是 SegmentTimeline、
 * ProjectTimeline 的哪个按钮、还是 Inspector 单 Take 试听，新启动的请求
 * 都先抢占旧任务、等其完整退出后再启动自己。这样 currentAudio 单例不会
 * 被多个 loop 同时争抢,也不会出现「旧 loop 的 audio 还没死,新 loop 的
 * audio 已经创建」的并发音频。
 *
 * 抢占接力靠 preemptAndRun:把 player.stop / set idle / 等待旧任务完成
 * 三件事打包,所有 play* 入口都走它。`if (state.playback !== 'idle') return`
 * 这种「忙了就拒绝」的旧守卫不再需要——抢占替代了拒绝。
 */

/**
 * 把节选区间整理成 player.playFile 的 options。
 *   - startMs === 0 时省略字段，避免对 currentTime 的多余赋值
 *   - endMs === fileDurationMs 时省略字段，避免无意义的 timeupdate 监听
 *
 * 等价于「无 trim 等同于不传 options」，让全段播放走最短路径
 */
function buildPlayOptions(
  range: { startMs: number; endMs: number },
  fileDurationMs: number
): { startMs?: number; endMs?: number } {
  const opts: { startMs?: number; endMs?: number } = {}
  if (range.startMs > 0) opts.startMs = range.startMs
  if (range.endMs < fileDurationMs) opts.endMs = range.endMs
  return opts
}

export const createPlaybackSlice: SliceCreator<
  Pick<
    EditorActions,
    | 'playCurrentSegment'
    | 'playCurrentSegmentFromHead'
    | 'setSegmentPlayhead'
    | 'playProject'
    | 'playProjectFromStart'
    | 'playProjectFromCurrentSegment'
    | 'stopPlayback'
    | 'togglePausePlayback'
    | 'setPlaybackRate'
  >
> = (set, get) => {
  // 全局唯一的「正在跑的播放任务」。每次 preemptAndRun 同步段内把它替换
  // 成自己的 promise,新的 preempt 都先 await 旧 promise——形成串行链
  let activePlaybackTask: Promise<void> = Promise.resolve()

  /**
   * 抢占式启动新播放任务。
   *
   * 同步段做三件事(JS 单线程,这里不会被新的 preempt 卡进中间):
   *   1. player.stop()——杀正在播的 audio + 让 in-flight 的 playFile
   *      在 await loadBlobUrl 后拿不到匹配的 activePlayFileId,放弃
   *      创建新 audio
   *   2. set playback 'idle'——旧 loop 下一次迭代检查 break 条件成立
   *   3. 创建本次任务的 promise,把 activePlaybackTask 立刻替换掉,后续
   *      preempt 都会 await 这个新 promise
   *
   * 然后 await 旧任务的 promise 完整退出,才执行 action。这样保证「真正
   * 进入 action body」时,任意旧 loop 都已经走完 finally 了
   */
  async function preemptAndRun(action: () => Promise<void>): Promise<void> {
    player.stop()
    set({ playback: 'idle', paused: false })

    const prior = activePlaybackTask
    let resolveOurs!: () => void
    const ours = new Promise<void>((resolve) => {
      resolveOurs = resolve
    })
    activePlaybackTask = ours

    // 旧任务可能 throw,我们不在乎——只要它退出就行
    await prior.catch(() => {})

    try {
      await action()
    } finally {
      resolveOurs()
    }
  }

  /**
   * 项目连读 loop 的真正实现。读 timelinePlayheadMs 决定起点;调用方负责
   * 在调用前把 playhead 设到目标位置(从头 / 从当前段头 / 不动 = 从游标
   * 当前位置)。
   */
  async function runProjectLoop(): Promise<void> {
    const state = get()

    // 收集可播 items + 累计起点：跳过缺失文件的 take。
    // 时间轴用「节选后的有效时长」累计——和 ProjectTimelineView 的 clip
    // 宽度计算保持一致，游标 / 起播 ms 都算的是「实际会播出来的那段时间」
    type PlayableItem = {
      segmentId: string
      filePath: string
      /** 在工程时间轴上的起点（已剔除前序段的 trim 段） */
      effectiveStartMs: number
      /** 本段实际会播出的时长（trimEnd - trimStart） */
      effectiveDurationMs: number
      /** 文件相对的 trim 区间，传给 player.playFile */
      trimStartMs: number
      trimEndMs: number
      fileDurationMs: number
    }
    const items: PlayableItem[] = []
    let cursor = 0
    for (const id of state.order) {
      const seg = state.segmentsById[id]
      const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
      if (take && !state.missingTakeIds.has(take.id)) {
        const range = takeEffectiveRange(take)
        const effectiveDur = range.endMs - range.startMs
        items.push({
          segmentId: id,
          filePath: take.filePath,
          effectiveStartMs: cursor,
          effectiveDurationMs: effectiveDur,
          trimStartMs: range.startMs,
          trimEndMs: range.endMs,
          fileDurationMs: take.durationMs
        })
        cursor += effectiveDur
      }
      cursor += seg?.gapAfter?.ms ?? 0
    }
    if (items.length === 0) return

    // 找游标对应的起播位置：第一个「结束 ms 大于 playhead」的段。如果
    // playhead 落在 gap 区间，会找到 gap 之后的下一段；如果 playhead
    // 超过总时长，回退到从头播
    const playhead = state.timelinePlayheadMs
    let startIdx = items.findIndex((it) => playhead < it.effectiveStartMs + it.effectiveDurationMs)
    if (startIdx < 0) startIdx = 0
    const offsetWithinFirst = Math.max(0, playhead - items[startIdx].effectiveStartMs)

    set({ playback: 'project', paused: false })
    try {
      for (let i = startIdx; i < items.length; i++) {
        const item = items[i]
        // stopPlayback / preemptAndRun 都会把 playback 切到 idle,
        // 让循环在下一次迭代退出
        if (get().playback !== 'project') break
        set({ selectedSegmentId: item.segmentId })
        pushWorkspace(get())
        // 第一段叠加段内偏移：trimStart + 用户在该段内的起播位置；
        // 后续段从 trimStart 起播。endMs 始终是 trimEnd
        const fileStartMs = (i === startIdx ? offsetWithinFirst : 0) + item.trimStartMs
        await player.playFile(
          item.filePath,
          buildPlayOptions({ startMs: fileStartMs, endMs: item.trimEndMs }, item.fileDurationMs)
        )

        // 段间间隔(gap)等待:模拟「预览输出音频」效果。导出时段与段
        // 之间会填充 gap.ms 长度的静音,连读应该等同样的时长才让
        // 「播放节奏」与「输出节奏」一致。
        // 间隔大小 = 下一 item 的 effectiveStartMs - 本 item 的结束 ms,
        // 已经把跳过的 missing take 那一截累加进 gap(他们 effectiveDur=0
        // 但 gap 仍然被 cursor 累加),所以这一减就拿到「真正应该等多久」
        if (i < items.length - 1 && get().playback === 'project') {
          const gapMs =
            items[i + 1].effectiveStartMs - (item.effectiveStartMs + item.effectiveDurationMs)
          if (gapMs > 0) {
            // 倍速生效:2x 速度下 gap 也只等一半。playbackRate 已 clamp 在
            // [0.25, 4],除法不会爆
            const rate = get().playbackRate || 1
            await sleepPausable(
              gapMs / rate,
              () => get().playback !== 'project',
              () => get().paused
            )
          }
        }
      }
      // 自然播完：把游标停在工程末尾，便于用户看到「播到哪了」
      if (get().playback === 'project') {
        set({ timelinePlayheadMs: cursor })
        pushWorkspace(get())
      }
    } finally {
      if (get().playback === 'project') set({ playback: 'idle', paused: false })
    }
  }

  return {
    /**
     * 播放当前选中 Segment 的当前 Take。从 segmentPlayheadMs 起播——
     * playhead 在 trim 范围内时尊重它,超出(自然播完后会停在 trimEnd)
     * 时回退到段头,避免「点击就立刻结束」。
     *
     * 缺失文件守卫：missingTakeIds 由 audit 扫描填充，命中时直接弹错——
     * 否则 player 会调 readTakeFile，main 抛 ENOENT，最终 audio 元素吐
     * 一个不显眼的 console.error，用户看不到反馈
     */
    playCurrentSegment: () =>
      preemptAndRun(async () => {
        const state = get()
        if (!state.selectedSegmentId) return
        const seg = state.segmentsById[state.selectedSegmentId]
        const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
        if (!take) return
        if (state.missingTakeIds.has(take.id)) {
          showError(
            i18n.t('errors.play_missing_take_title'),
            i18n.t('errors.play_missing_take_description')
          )
          return
        }

        // 节选区间：take 设了 trim 就只播节选段，否则整段
        const range = takeEffectiveRange(take)
        // 从 segmentPlayheadMs 起播,但要 clamp 到 trim 范围内。playhead
        // 在 trim 区间外 (< start 或 >= end) 时退回段头——前者是「越界」,
        // 后者是「自然播完后位置」,都不该让 playFile 立即结束
        const playhead = state.segmentPlayheadMs
        const startFrom =
          playhead > range.startMs && playhead < range.endMs ? playhead : range.startMs
        const playOpts = buildPlayOptions(
          { startMs: startFrom, endMs: range.endMs },
          take.durationMs
        )

        set({ playback: 'segment', paused: false })
        try {
          await player.playFile(take.filePath, playOpts)
        } finally {
          if (get().playback === 'segment') set({ playback: 'idle', paused: false })
        }
      }),

    /**
     * 从段头播放当前 Segment——把 segmentPlayheadMs 归零再 playCurrentSegment。
     * 保证总是从 trim 起点起播,跟「从游标位置」按钮形成对照
     */
    playCurrentSegmentFromHead: () =>
      preemptAndRun(async () => {
        set({ segmentPlayheadMs: 0 })
        // 内联走 playCurrentSegment 的逻辑(不能调 get().playCurrentSegment()
        // ——那会再走一次 preemptAndRun,把自己当成旧任务等死)
        const state = get()
        if (!state.selectedSegmentId) return
        const seg = state.segmentsById[state.selectedSegmentId]
        const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
        if (!take) return
        if (state.missingTakeIds.has(take.id)) {
          showError(
            i18n.t('errors.play_missing_take_title'),
            i18n.t('errors.play_missing_take_description')
          )
          return
        }
        const range = takeEffectiveRange(take)
        const playOpts = buildPlayOptions(range, take.durationMs)
        set({ playback: 'segment', paused: false })
        try {
          await player.playFile(take.filePath, playOpts)
        } finally {
          if (get().playback === 'segment') set({ playback: 'idle', paused: false })
        }
      }),

    /** 直接写段内游标位置。WaveformView 点击 / 拖动 / 暂停时用 */
    setSegmentPlayhead: (ms) => {
      const next = Math.max(0, ms)
      if (get().segmentPlayheadMs === next) return
      set({ segmentPlayheadMs: next })
    },

    /**
     * 从游标当前位置连续播放工程剩余 take。和 Slice D1 的实现不同:
     * 顺序循环放在 store 里,每段开始前同步 selectedSegmentId,UI 跟随
     * 当前播放段高亮 + 自动滚动。
     *
     * 起点由 timelinePlayheadMs 决定:游标落在哪段的有效区间内,从那
     * 段的对应位置起播;落在 gap 区间则从下一段起播;超过总时长回退
     * 到工程开头
     */
    playProject: () => preemptAndRun(runProjectLoop),

    /**
     * 「从项目头开始」按钮:把游标设到 0 后跑 runProjectLoop。**不**改
     * selectedSegmentId——选中是文档维度状态,跟「我要从哪播」无关
     */
    playProjectFromStart: () =>
      preemptAndRun(async () => {
        set({ timelinePlayheadMs: 0 })
        pushWorkspace(get())
        await runProjectLoop()
      }),

    /**
     * 「从当前段开始」按钮:把游标设到当前选中 Segment 的累计起点 ms 后
     * runProjectLoop。selectedSegmentId 同样不变。算法与
     * ProjectTimelineView 的 startMsById 一致:累加前序段的有效时长 +
     * gapAfter
     */
    playProjectFromCurrentSegment: () =>
      preemptAndRun(async () => {
        const state = get()
        const selId = state.selectedSegmentId
        if (!selId) {
          // 没选中段时退回从头播——按钮可能是错误地暴露给用户的状态,
          // 但走「从头」比啥都不做更接近预期
          set({ timelinePlayheadMs: 0 })
          pushWorkspace(get())
          await runProjectLoop()
          return
        }
        let acc = 0
        for (const id of state.order) {
          if (id === selId) break
          const seg = state.segmentsById[id]
          const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
          if (take && !state.missingTakeIds.has(take.id)) {
            acc += takeEffectiveDurationMs(take)
          }
          acc += seg?.gapAfter?.ms ?? 0
        }
        set({ timelinePlayheadMs: acc })
        pushWorkspace(get())
        await runProjectLoop()
      }),

    /**
     * 停止播放。直接把 playback 切回 idle(不等 playFile 的 finally),
     * 这样 runProjectLoop 循环能立刻看到状态变化并退出,不会多播一段。
     * segment 播放停止时顺手把 segmentPlayheadMs 写到当前位置——下次
     * 「从游标位置」按钮就从这里接着播
     */
    stopPlayback: () => {
      const state = get()
      if (state.playback === 'segment' || state.playback === 'project') {
        if (state.playback === 'segment') {
          set({ segmentPlayheadMs: player.getCurrentTimeMs() })
        }
        player.stop()
        set({ playback: 'idle', paused: false })
      }
    },

    /**
     * 暂停 ↔ 恢复。仅在播放中有意义；idle / recording 时 no-op。
     * 实际的音频暂停 / 恢复交给 player service；本函数只同步状态位。
     * segment 暂停时同步 segmentPlayheadMs,让 WaveformView 的静态游标
     * 停在用户暂停的位置
     */
    togglePausePlayback: () => {
      const state = get()
      if (state.playback !== 'segment' && state.playback !== 'project') return
      if (state.paused) {
        player.resume()
        set({ paused: false })
      } else {
        player.pause()
        if (state.playback === 'segment') {
          set({ segmentPlayheadMs: player.getCurrentTimeMs() })
        }
        set({ paused: true })
      }
    },

    /**
     * 设置播放倍速并立即应用到当前 audio（如有）+ 之后所有 player.playFile
     * 调用。clamp 到 [PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX]
     */
    setPlaybackRate: (rate) => {
      const clamped = Math.max(PLAYBACK_RATE_MIN, Math.min(PLAYBACK_RATE_MAX, rate))
      if (get().playbackRate === clamped) return
      set({ playbackRate: clamped })
      player.setPlaybackRate(clamped)
    }
  }
}
