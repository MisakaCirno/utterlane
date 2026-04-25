import { useEffect, useRef, useState } from 'react'
import {
  Play,
  Square,
  Mic,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Scissors,
  Pilcrow,
  FolderOpen,
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
            (() => {
              // gap 三态映射到 UI：
              //   undefined           → ms=0, follow=true（未触碰，等待
              //                          applyDefaultGaps 写入）
              //   { ms, manual:false } → follow=true（已自动写入，下次默认
              //                          应用还会被覆盖）
              //   { ms, manual:true }  → follow=false（用户手动设置，
              //                          applyDefaultGaps 跳过）
              const followsGlobal = !segment.gapAfter || !segment.gapAfter.manual
              const currentMs = segment.gapAfter?.ms ?? 0
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* 数字输入。改值即落 manual: true：用户键入显式数字就是
                      在表达「这一段就用这个数」，自动 uncheck follow */}
                  <input
                    type="number"
                    min={0}
                    step={50}
                    value={currentMs}
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
                  <label
                    className={cn(
                      'inline-flex items-center gap-1 text-2xs text-fg-dim',
                      playback !== 'idle' && 'cursor-not-allowed opacity-50'
                    )}
                    title={t('inspector.gap_after_follow_global_hint')}
                  >
                    <input
                      type="checkbox"
                      checked={followsGlobal}
                      onChange={(e) =>
                        setSegmentGap(selectedId, {
                          ms: currentMs,
                          manual: !e.currentTarget.checked
                        })
                      }
                      disabled={playback !== 'idle'}
                      className="h-3 w-3 cursor-pointer accent-accent disabled:cursor-not-allowed"
                    />
                    {t('inspector.gap_after_follow_global')}
                  </label>
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
              )
            })()
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

      {segment.takes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-2xs text-fg-dim">
          {t('inspector.takes_empty')}
        </div>
      ) : (
        // 表格容器：Inspector 太窄时横向溢出滚动，让所有列都可访问。
        // 纵向独立滚动让长 take 列表也能用
        <div className="flex-1 overflow-auto">
          <TakesTable
            segmentId={selectedId}
            takes={segment.takes}
            selectedTakeId={segment.selectedTakeId}
            missingTakeIds={missingTakeIds}
            playback={playback}
            setSelectedTake={setSelectedTake}
            setTakeTrim={setTakeTrim}
            deleteTake={deleteTake}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Take 列表的表格视图。8 列：
 *   1. 启用（语义上是单选 = selectedTakeId，按 user 要求渲染成 checkbox）
 *   2. 名称（Take N + 缺失徽标）
 *   3. 节选起点（ms 数字输入）
 *   4. 节选终点（ms 数字输入）
 *   5. 持续时间 / 总时间
 *   6. 试听
 *   7. 删除
 *   8. 在系统文件管理器中定位
 *
 * 用 CSS grid 让所有行的列宽对齐。最小宽度收紧到能放 6 列 24px 按钮 +
 * 名称 + 输入：约 280px；Inspector 实际更窄时由 overflow-auto 接管成
 * 横向滚动条，所有功能仍可达
 */
const TAKE_GRID_COLS =
  'grid-cols-[20px_minmax(48px,auto)_60px_60px_minmax(96px,1fr)_24px_24px_24px]'

function TakesTable({
  segmentId,
  takes,
  selectedTakeId,
  missingTakeIds,
  playback,
  setSelectedTake,
  setTakeTrim,
  deleteTake
}: {
  segmentId: string
  takes: import('@shared/project').Take[]
  selectedTakeId: string | undefined
  missingTakeIds: ReadonlySet<string>
  playback: string
  setSelectedTake: (segmentId: string, takeId: string) => void
  setTakeTrim: (
    segmentId: string,
    takeId: string,
    trim: { startMs: number; endMs: number } | undefined
  ) => void
  deleteTake: (segmentId: string, takeId: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isIdle = playback === 'idle'

  return (
    // min-w-max 让 grid 在窄面板下保留全部列宽（不被父级压扁），由父级
    // overflow-auto 兜成横向滚动
    <div className="min-w-max">
      {/* 表头：sticky 让滚动 take 列表时列名一直可见 */}
      <div
        className={cn(
          'sticky top-0 z-10 grid items-center gap-1 border-b border-border bg-bg px-3 py-1',
          'text-2xs font-medium text-fg-muted',
          TAKE_GRID_COLS
        )}
      >
        <span />
        <span>{t('inspector.col_take')}</span>
        <span className="text-right">{t('inspector.col_trim_start')}</span>
        <span className="text-right">{t('inspector.col_trim_end')}</span>
        <span className="text-right">{t('inspector.col_duration')}</span>
        <span />
        <span />
        <span />
      </div>

      {takes.map((take, i) => {
        const isCurrent = take.id === selectedTakeId
        const isMissing = missingTakeIds.has(take.id)
        const effectiveRange = takeEffectiveRange(take)
        const isTrimmed = effectiveRange.startMs > 0 || effectiveRange.endMs < take.durationMs
        const effectiveDur = takeEffectiveDurationMs(take)

        const onPlay = (): void => {
          // 与之前的「逐 Take 试听」语义一致：节选只播节选段
          const opts: { startMs?: number; endMs?: number } = {}
          if (effectiveRange.startMs > 0) opts.startMs = effectiveRange.startMs
          if (effectiveRange.endMs < take.durationMs) opts.endMs = effectiveRange.endMs
          void player.playFile(take.filePath, opts)
        }

        const onReveal = (): void => {
          void window.api.project.revealTakeFile(take.filePath)
        }

        return (
          <div
            key={take.id}
            className={cn(
              'grid items-center gap-1 border-b border-border-subtle px-3 py-1 text-xs',
              TAKE_GRID_COLS,
              isCurrent ? 'bg-accent-soft/40' : 'hover:bg-bg-raised'
            )}
          >
            {/* 1. 启用：实际是 selectedTakeId 单选，按 user 要求用 checkbox
                  外观。点击当前选中的不会取消（store 不接受 undefined） */}
            <input
              type="checkbox"
              checked={isCurrent}
              onChange={() => {
                if (!isCurrent) setSelectedTake(segmentId, take.id)
              }}
              disabled={!isIdle || isCurrent}
              aria-label={isCurrent ? t('inspector.take_current') : t('inspector.take_set_current')}
              title={isCurrent ? t('inspector.take_current') : t('inspector.take_set_current')}
              className="h-3 w-3 cursor-pointer accent-accent disabled:cursor-default"
            />

            {/* 2. 名称 + 缺失徽标 */}
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate">{t('inspector.take_item', { index: i + 1 })}</span>
              {isMissing && (
                <AlertTriangle
                  size={10}
                  className="shrink-0 text-rec"
                  aria-label={t('audit_dialog.inspector_missing_badge')}
                />
              )}
            </div>

            {/* 3. 节选起点 */}
            <NumInput
              value={effectiveRange.startMs}
              min={0}
              max={Math.max(0, effectiveRange.endMs - 1)}
              disabled={!isIdle || isMissing}
              title={formatDuration(effectiveRange.startMs)}
              onChange={(v) =>
                setTakeTrim(segmentId, take.id, {
                  startMs: v,
                  endMs: effectiveRange.endMs
                })
              }
            />

            {/* 4. 节选终点 */}
            <NumInput
              value={effectiveRange.endMs}
              min={effectiveRange.startMs + 1}
              max={take.durationMs}
              disabled={!isIdle || isMissing}
              title={formatDuration(effectiveRange.endMs)}
              onChange={(v) =>
                setTakeTrim(segmentId, take.id, {
                  startMs: effectiveRange.startMs,
                  endMs: Math.min(take.durationMs, Math.max(0, v))
                })
              }
            />

            {/* 5. 时长：节选时显示「有效 / 原始」，否则只显示总时长 */}
            <div
              className="text-right font-mono text-2xs tabular-nums text-fg-muted"
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
                  <span className="ml-1 text-fg-dim/70">/ {formatDuration(take.durationMs)}</span>
                </>
              ) : (
                formatDuration(take.durationMs)
              )}
            </div>

            {/* 6. 试听 */}
            <IconActionButton
              onClick={onPlay}
              disabled={isMissing || !isIdle}
              title={t('inspector.take_play_aria')}
            >
              <Play size={11} />
            </IconActionButton>

            {/* 7. 删除 */}
            <IconActionButton
              onClick={() => deleteTake(segmentId, take.id)}
              danger
              title={t('inspector.take_delete_aria')}
            >
              <Trash2 size={11} />
            </IconActionButton>

            {/* 8. 在文件管理器中定位 */}
            <IconActionButton
              onClick={onReveal}
              disabled={isMissing}
              title={t('inspector.take_reveal_aria')}
            >
              <FolderOpen size={11} />
            </IconActionButton>
          </div>
        )
      })}
    </div>
  )
}

/** Trim 列共用的 ms 数字输入。把样式 / 解析逻辑收成一个组件，避免 4 处重复 */
function NumInput({
  value,
  min,
  max,
  disabled,
  title,
  onChange
}: {
  value: number
  min: number
  max: number
  disabled?: boolean
  title?: string
  onChange: (next: number) => void
}): React.JSX.Element {
  return (
    <input
      type="number"
      min={min}
      max={max}
      step={10}
      value={value}
      disabled={disabled}
      title={title}
      onChange={(e) => {
        const raw = parseInt(e.currentTarget.value, 10)
        onChange(Number.isFinite(raw) ? Math.max(0, raw) : 0)
      }}
      className={cn(
        'w-full rounded-sm border border-border bg-bg-deep px-1 py-0.5',
        'text-right font-mono text-2xs tabular-nums text-fg',
        'outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50'
      )}
    />
  )
}

/** 表格右侧三个 24px 图标按钮的统一样式：保持列宽对齐 */
function IconActionButton({
  children,
  onClick,
  danger,
  disabled,
  title
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  title: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-muted',
        danger ? 'hover:bg-bg-raised hover:text-rec' : 'hover:bg-bg-raised hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}
