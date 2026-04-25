import { useEffect, useRef, useState } from 'react'
import {
  Play,
  Square,
  Mic,
  RotateCcw,
  Trash2,
  Check,
  Circle,
  AlertTriangle,
  Scissors,
  Pilcrow,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { confirm } from '@renderer/store/confirmStore'
import { formatDuration } from '@renderer/lib/format'
import { Field } from '@renderer/components/Field'
import { TextEditorWithCount } from '@renderer/components/TextEditorWithCount'
import { subscribeLevel } from '@renderer/services/recorder'
import * as player from '@renderer/services/player'
import { amplitudeToDb, dbToFill, formatDb } from '@renderer/lib/audio'
import { DEFAULT_PREFERENCES } from '@shared/preferences'
import { takeEffectiveDurationMs, takeEffectiveRange } from '@shared/project'

/**
 * 录音输入电平条（横向）。订阅 recorder.subscribeLevel 获取实时 RMS，
 * 转 dBFS 后映射到 [0, 1] 填充比例。
 *
 * 显示：
 *   - 条：左边到 fillRatio 的彩色填充。色带是从左到右的绿→黄→红渐变，
 *     mask 只露出当前 fill 之内的部分
 *   - 数值：dBFS。voice 通常 -30 ~ -10 dB；越接近 0 越响
 *
 * RAF 节流：回调可能每 ~20ms 触发一次，靠 requestAnimationFrame 合并到下一帧渲染，
 * 避免 React 高频重渲染。
 */
function LevelMeter(): React.JSX.Element {
  const { t } = useTranslation()
  const [level, setLevel] = useState(0)

  useEffect(() => {
    let pending = 0
    let rafId: number | null = null
    const flush = (): void => {
      rafId = null
      setLevel(pending)
    }
    const off = subscribeLevel((l) => {
      pending = l
      if (rafId === null) rafId = requestAnimationFrame(flush)
    })
    return () => {
      off()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  const db = amplitudeToDb(level)
  const fillRatio = dbToFill(db)

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <span className="text-2xs text-fg-muted">{t('inspector.level_label')}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-bg-deep">
        {/* 色带打底：左→右 绿→黄→红渐变。位置 75% / 90% 与 LevelMeterView 一致 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgb(34 197 94) 0%, rgb(34 197 94) 60%, rgb(234 179 8) 75%, rgb(234 179 8) 85%, rgb(239 68 68) 95%)'
          }}
        />
        {/* 反向遮罩：从右往左盖住超出 fill 的部分 */}
        <div
          className="absolute right-0 top-0 bottom-0 bg-bg-deep transition-[width] duration-75"
          style={{ width: `${(1 - fillRatio) * 100}%` }}
        />
      </div>
      <span className="w-14 text-right font-mono text-2xs tabular-nums text-fg-dim">
        {formatDb(db)}
      </span>
    </div>
  )
}

function ToolbarButton({
  children,
  onClick,
  active,
  danger,
  disabled,
  title
}: {
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-6 items-center gap-1 rounded-sm border px-2 text-2xs',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'border-accent bg-accent-soft text-white'
          : danger
            ? 'border-border bg-bg-raised text-fg hover:border-rec hover:text-rec'
            : 'border-border bg-bg-raised text-fg hover:border-border-strong hover:bg-chrome-hover'
      )}
    >
      {children}
    </button>
  )
}

export function InspectorView(): React.JSX.Element {
  const { t } = useTranslation()
  const order = useEditorStore((s) => s.order)
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )
  const editSegmentText = useEditorStore((s) => s.editSegmentText)
  const deleteSegment = useEditorStore((s) => s.deleteSegment)
  const splitSegmentAt = useEditorStore((s) => s.splitSegmentAt)
  const recommendedMaxChars = useEditorStore((s) => s.project?.recommendedMaxChars)
  const setSelectedTake = useEditorStore((s) => s.setSelectedTake)
  const deleteTake = useEditorStore((s) => s.deleteTake)
  const setParagraphStart = useEditorStore((s) => s.setParagraphStart)
  const setSegmentGap = useEditorStore((s) => s.setSegmentGap)
  const setTakeTrim = useEditorStore((s) => s.setTakeTrim)
  const playback = useEditorStore((s) => s.playback)
  const recordingSegmentId = useEditorStore((s) => s.recordingSegmentId)
  const missingTakeIds = useEditorStore((s) => s.missingTakeIds)
  const startRecording = useEditorStore((s) => s.startRecordingForSelected)
  const startRerecording = useEditorStore((s) => s.startRerecordingSelected)
  const stopRecording = useEditorStore((s) => s.stopRecordingAndSave)
  const cancelRecording = useEditorStore((s) => s.cancelRecording)
  const playCurrentSegment = useEditorStore((s) => s.playCurrentSegment)
  const stopPlayback = useEditorStore((s) => s.stopPlayback)
  const textAlign = usePreferencesStore(
    (s) =>
      s.prefs.appearance?.inspectorTextAlign ?? DEFAULT_PREFERENCES.appearance!.inspectorTextAlign!
  )

  // hooks 必须在早返回之前注册，所以 ref / focus state 都搬到这里——
  // 即便没有选中 Segment 时也调用一次，保持 hook 顺序稳定
  const textInputRef = useRef<HTMLInputElement | null>(null)
  const [hasTextFocus, setHasTextFocus] = useState(false)

  if (!segment || !selectedId) {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-2xs text-fg-dim">
        {t('inspector.unselected')}
      </div>
    )
  }

  const index = order.indexOf(selectedId)
  const isLast = index === order.length - 1
  // 段首：order 第 0 个恒为段首；其他看显式 paragraphStart 标志
  const isParagraphHead = index === 0 || !!segment.paragraphStart

  // 只有这条 Segment 正在被录音时才把按钮切换成「停止 / 取消」；
  // 其他 Segment 被录音时，当前这条按钮保持 idle 状态但整体 disabled
  const isRecordingThis = playback === 'recording' && recordingSegmentId === selectedId
  const isRecordingOther = playback === 'recording' && !isRecordingThis

  const onDeleteSegment = async (): Promise<void> => {
    const ok = await confirm({
      title: t('confirm.delete_segment_title'),
      description: segment.text,
      confirmLabel: t('common.delete'),
      tone: 'danger'
    })
    if (ok) deleteSegment(selectedId)
  }

  // 拆分按钮：从 textarea 取当前光标位置（selectionStart）。
  // 用户得先聚焦 textarea 把光标放到拆分点，再点这个按钮。
  // 失焦时禁用按钮——避免点了不知道从哪拆。光标在两端时 splitSegmentAt
  // 内部会 no-op，无需在这里再判定（cursor 位置不进 React state，免得
  // 每次 selectionchange 都触发渲染）
  const onSplit = (): void => {
    const ta = textInputRef.current
    if (!ta) return
    const at = ta.selectionStart
    if (at == null) return
    splitSegmentAt(selectedId, at)
  }
  const canSplit = hasTextFocus && playback === 'idle' && segment.text.length > 1

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="border-b border-border px-3 py-2">
        <Field label={t('inspector.field_order')}>
          <span className="font-mono tabular-nums">
            {index + 1} / {order.length}
          </span>
        </Field>
        <Field label={t('inspector.field_text')}>
          <TextEditorWithCount
            inputRef={textInputRef}
            value={segment.text}
            onChange={(v) => editSegmentText(selectedId, v)}
            onFocus={() => setHasTextFocus(true)}
            onBlur={() => setHasTextFocus(false)}
            recommendedMaxChars={recommendedMaxChars}
            textAlign={textAlign}
          />
        </Field>
        <Field label={t('inspector.field_paragraph')}>
          <button
            type="button"
            onClick={() => setParagraphStart(selectedId, !isParagraphHead)}
            disabled={playback !== 'idle' || index === 0}
            // 首段恒为段首，按钮 disabled；非 idle 也 disabled，避免播放 /
            // 录音中改写段落结构
            title={index === 0 ? t('inspector.paragraph_first_locked_hint') : undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isParagraphHead
                ? 'border-accent bg-accent-soft text-white'
                : 'border-border bg-bg-raised text-fg hover:border-border-strong'
            )}
          >
            <Pilcrow size={11} />
            {isParagraphHead ? t('inspector.paragraph_head_yes') : t('inspector.paragraph_head_no')}
          </button>
        </Field>
        <Field label={t('inspector.field_gap_after')}>
          {isLast ? (
            // 最后一段后面没有「下一段」，gap 在导出 / 时间轴里都没意义
            <span className="text-fg-dim" title={t('inspector.gap_after_last_hint')}>
              {t('inspector.gap_after_last')}
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              {/* 数字输入。改值即落 manual: true，applyDefaultGaps 会跳过此段
                  保留用户意图。空字符串 / NaN 视作 0 */}
              <input
                type="number"
                min={0}
                step={50}
                value={segment.gapAfter?.ms ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.currentTarget.value, 10) || 0)
                  setSegmentGap(selectedId, { ms: v, manual: true })
                }}
                disabled={playback !== 'idle'}
                className={cn(
                  'w-20 rounded-sm border border-border bg-bg-deep px-1.5 py-0.5',
                  'text-right font-mono text-xs tabular-nums text-fg',
                  'outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50'
                )}
              />
              <span className="text-2xs text-fg-muted">ms</span>
              <span className="text-2xs text-fg-dim">
                {segment.gapAfter
                  ? segment.gapAfter.manual
                    ? t('inspector.gap_after_manual')
                    : t('inspector.gap_after_auto')
                  : t('inspector.gap_after_unset')}
              </span>
              {segment.gapAfter && (
                <button
                  type="button"
                  onClick={() => setSegmentGap(selectedId, undefined)}
                  disabled={playback !== 'idle'}
                  title={t('inspector.gap_after_clear_hint')}
                  className="rounded-sm p-0.5 text-fg-muted hover:bg-bg-raised hover:text-rec disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          )}
        </Field>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <ToolbarButton
          active={playback === 'segment'}
          onClick={playback === 'segment' ? stopPlayback : () => void playCurrentSegment()}
          disabled={
            isRecordingOther || isRecordingThis || playback === 'project' || !segment.selectedTakeId
          }
        >
          {playback === 'segment' ? <Square size={11} /> : <Play size={11} />}
          {playback === 'segment' ? t('inspector.btn_stop') : t('inspector.btn_play')}
        </ToolbarButton>
        <ToolbarButton
          onClick={stopPlayback}
          disabled={isRecordingOther || isRecordingThis || playback === 'idle'}
        >
          <Square size={11} />
          {t('inspector.btn_stop')}
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-border" />
        {isRecordingThis ? (
          <>
            <ToolbarButton active danger onClick={stopRecording}>
              <Square size={11} />
              {t('inspector.btn_stop_recording')}
            </ToolbarButton>
            <ToolbarButton onClick={cancelRecording}>{t('inspector.btn_cancel')}</ToolbarButton>
          </>
        ) : (
          <>
            <ToolbarButton onClick={startRecording} disabled={isRecordingOther}>
              <Mic size={11} />
              {t('inspector.btn_record')}
            </ToolbarButton>
            <ToolbarButton
              onClick={startRerecording}
              disabled={isRecordingOther || !segment.selectedTakeId}
            >
              <RotateCcw size={11} />
              {t('inspector.btn_rerecord')}
            </ToolbarButton>
          </>
        )}
        <div className="mx-1 h-4 w-px bg-border" />
        {/*
          拆分按钮：留在 Inspector 是因为它依赖光标在 textarea 中的位置——
          SegmentsView 的右键菜单里没有 textarea 焦点，没法做。
          合并 / 段首切换搬到了 SegmentsView 工具栏 + 右键菜单
        */}
        <ToolbarButton onClick={onSplit} disabled={!canSplit} title={t('inspector.btn_split_hint')}>
          <Scissors size={11} />
          {t('inspector.btn_split')}
        </ToolbarButton>
        <div className="ml-auto" />
        <ToolbarButton danger onClick={onDeleteSegment} disabled={isRecordingThis}>
          <Trash2 size={11} />
          {t('inspector.btn_delete_segment')}
        </ToolbarButton>
      </div>

      {isRecordingThis && <LevelMeter />}

      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-2xs text-fg-muted">{t('inspector.takes_label')}</span>
        <span className="text-2xs text-fg-dim">
          {t('inspector.takes_count', { count: segment.takes.length })}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {segment.takes.length === 0 ? (
          <div className="flex h-full items-center justify-center text-2xs text-fg-dim">
            {t('inspector.takes_empty')}
          </div>
        ) : (
          segment.takes.map((take, i) => {
            const isCurrent = take.id === segment.selectedTakeId
            const isMissing = missingTakeIds.has(take.id)
            // 节选信息：trim 字段缺失 → 整段，UI 不显示 trim 行 / 仅显示
            // 单一时长。trim 设置过 → 显示「有效 / 原始」两个数字 + 起止
            // 时间，让用户在 list 里就能看清裁了多少
            const effectiveRange = takeEffectiveRange(take)
            const isTrimmed = effectiveRange.startMs > 0 || effectiveRange.endMs < take.durationMs
            const effectiveDur = takeEffectiveDurationMs(take)
            return (
              <div
                key={take.id}
                className={cn(
                  // h-8 → min-h-8 + auto：trim 时多一行 trim 范围，整体高度
                  // 自适应而不是把第二行裁掉
                  'flex min-h-8 items-center gap-2 border-b border-border-subtle px-3 py-1 text-xs',
                  isCurrent ? 'bg-accent-soft/40' : 'hover:bg-bg-raised'
                )}
              >
                <div className="flex w-4 items-center justify-center self-start pt-1">
                  {isCurrent ? (
                    <Check size={12} className="text-accent" />
                  ) : (
                    <Circle size={8} className="text-fg-dim" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="truncate">{t('inspector.take_item', { index: i + 1 })}</div>
                  {isCurrent ? (
                    // 当前 Take：trim 起 / 终点改成可编辑数字输入。0 / duration
                    // 即「未节选」，setTakeTrim 会自动把 trim 字段从 Take 上
                    // 删除（store 内部清洗）。playback 非 idle 时锁住，与
                    // 其他 mutate 入口一致
                    <div className="flex flex-wrap items-center gap-1 text-2xs tabular-nums text-fg-dim">
                      <Scissors size={9} />
                      <input
                        type="number"
                        min={0}
                        max={Math.max(0, effectiveRange.endMs - 1)}
                        step={10}
                        value={effectiveRange.startMs}
                        onChange={(e) => {
                          const raw = parseInt(e.currentTarget.value, 10)
                          const next = Number.isFinite(raw) ? Math.max(0, raw) : 0
                          setTakeTrim(selectedId, take.id, {
                            startMs: next,
                            endMs: effectiveRange.endMs
                          })
                        }}
                        disabled={playback !== 'idle' || isMissing}
                        title={formatDuration(effectiveRange.startMs)}
                        className={cn(
                          'w-16 rounded-sm border border-border bg-bg-deep px-1 py-0.5',
                          'text-right font-mono text-2xs tabular-nums text-fg',
                          'outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      />
                      <span className="text-fg-muted">ms →</span>
                      <input
                        type="number"
                        min={effectiveRange.startMs + 1}
                        max={take.durationMs}
                        step={10}
                        value={effectiveRange.endMs}
                        onChange={(e) => {
                          const raw = parseInt(e.currentTarget.value, 10)
                          const next = Number.isFinite(raw)
                            ? Math.min(take.durationMs, Math.max(0, raw))
                            : take.durationMs
                          setTakeTrim(selectedId, take.id, {
                            startMs: effectiveRange.startMs,
                            endMs: next
                          })
                        }}
                        disabled={playback !== 'idle' || isMissing}
                        title={formatDuration(effectiveRange.endMs)}
                        className={cn(
                          'w-16 rounded-sm border border-border bg-bg-deep px-1 py-0.5',
                          'text-right font-mono text-2xs tabular-nums text-fg',
                          'outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50'
                        )}
                      />
                      <span className="text-fg-muted">ms</span>
                      {isTrimmed && (
                        <button
                          type="button"
                          onClick={() => setTakeTrim(selectedId, take.id, undefined)}
                          disabled={playback !== 'idle'}
                          title={t('inspector.take_trim_clear_hint')}
                          className="rounded-sm p-0.5 text-fg-muted hover:bg-bg-raised hover:text-rec disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ) : (
                    // 非当前 Take：保留只读时间显示；要改先「设为当前」
                    isTrimmed && (
                      <div className="flex items-center gap-1 font-mono text-2xs tabular-nums text-fg-dim">
                        <Scissors size={9} />
                        <span>
                          {formatDuration(effectiveRange.startMs)}
                          <span className="px-0.5 text-fg-muted">→</span>
                          {formatDuration(effectiveRange.endMs)}
                        </span>
                      </div>
                    )
                  )}
                </div>
                {isMissing && (
                  <div
                    className="flex items-center gap-0.5 rounded-sm border border-rec/60 bg-rec/10 px-1 text-2xs text-rec"
                    title={t('audit_dialog.inspector_missing_tooltip')}
                  >
                    <AlertTriangle size={9} />
                    {t('audit_dialog.inspector_missing_badge')}
                  </div>
                )}
                <div
                  className="w-24 text-right font-mono text-2xs tabular-nums text-fg-muted"
                  title={
                    isTrimmed
                      ? t('inspector.take_duration_trimmed_hint', {
                          effective: formatDuration(effectiveDur),
                          total: formatDuration(take.durationMs)
                        })
                      : undefined
                  }
                >
                  {isTrimmed ? (
                    <>
                      {formatDuration(effectiveDur)}
                      <span className="ml-1 text-fg-dim/70">
                        / {formatDuration(take.durationMs)}
                      </span>
                    </>
                  ) : (
                    formatDuration(take.durationMs)
                  )}
                </div>
                <button
                  // 单 take 试听：直接走 player.playFile，不走 store 的
                  // playCurrentSegment——后者只播 selectedTakeId，这里允许
                  // 用户预览非当前 take 而不必先「设为当前」。
                  // 节选 take 也只播节选段，与 playCurrentSegment 一致
                  onClick={() => {
                    const range = takeEffectiveRange(take)
                    const opts: { startMs?: number; endMs?: number } = {}
                    if (range.startMs > 0) opts.startMs = range.startMs
                    if (range.endMs < take.durationMs) opts.endMs = range.endMs
                    void player.playFile(take.filePath, opts)
                  }}
                  disabled={isMissing || playback !== 'idle'}
                  aria-label={t('inspector.take_play_aria')}
                  title={t('inspector.take_play_aria')}
                  className={cn(
                    'rounded-sm p-1 text-fg-muted hover:bg-bg-raised hover:text-fg',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted'
                  )}
                >
                  <Play size={11} />
                </button>
                <button
                  onClick={() => setSelectedTake(selectedId, take.id)}
                  className={cn(
                    'rounded-sm px-1.5 py-0.5 text-2xs',
                    isCurrent ? 'text-accent' : 'text-fg-muted hover:bg-bg-raised hover:text-fg'
                  )}
                  disabled={isCurrent}
                >
                  {isCurrent ? t('inspector.take_current') : t('inspector.take_set_current')}
                </button>
                <button
                  onClick={() => deleteTake(selectedId, take.id)}
                  className="rounded-sm p-1 text-fg-muted hover:bg-bg-raised hover:text-rec"
                  aria-label={t('inspector.take_delete_aria')}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
