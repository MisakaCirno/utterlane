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
  Scissors
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
import { DEFAULT_PREFERENCES } from '@shared/preferences'

/**
 * 输入电平条。订阅 recorder.subscribeLevel 获取实时 RMS，
 * 用 CSS transform scaleX 做条形指示；切 0.6 之上变黄、0.85 以上变红提示削波风险。
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

  // 视觉范围扩大一下（RMS 普通讲话 0.05~0.2），0.5 ≈ 满刻度的 100%
  const scaled = Math.min(1, level * 2)
  const color = scaled > 0.85 ? 'bg-rec' : scaled > 0.6 ? 'bg-yellow-500' : 'bg-ok'

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <span className="text-2xs text-fg-muted">{t('inspector.level_label')}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-bg-deep">
        <div
          className={cn('h-full origin-left transition-[width] duration-75', color)}
          style={{ width: `${Math.round(scaled * 100)}%` }}
        />
      </div>
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
            return (
              <div
                key={take.id}
                className={cn(
                  'flex h-8 items-center gap-2 border-b border-border-subtle px-3 text-xs',
                  isCurrent ? 'bg-accent-soft/40' : 'hover:bg-bg-raised'
                )}
              >
                <div className="flex w-4 items-center justify-center">
                  {isCurrent ? (
                    <Check size={12} className="text-accent" />
                  ) : (
                    <Circle size={8} className="text-fg-dim" />
                  )}
                </div>
                <div className="flex-1 truncate">{t('inspector.take_item', { index: i + 1 })}</div>
                {isMissing && (
                  <div
                    className="flex items-center gap-0.5 rounded-sm border border-rec/60 bg-rec/10 px-1 text-2xs text-rec"
                    title={t('audit_dialog.inspector_missing_tooltip')}
                  >
                    <AlertTriangle size={9} />
                    {t('audit_dialog.inspector_missing_badge')}
                  </div>
                )}
                <div className="w-16 text-right font-mono text-2xs tabular-nums text-fg-muted">
                  {formatDuration(take.durationMs)}
                </div>
                <button
                  // 单 take 试听：直接走 player.playFile，不走 store 的
                  // playCurrentSegment——后者只播 selectedTakeId，这里允许
                  // 用户预览非当前 take 而不必先「设为当前」
                  onClick={() => void player.playFile(take.filePath)}
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
