import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { cn } from '@renderer/lib/cn'
import { useEditorStore } from '@renderer/store/editorStore'
import { usePreferencesStore } from '@renderer/store/preferencesStore'
import { WaveformView } from '@renderer/components/WaveformView'
import { TextEditorWithCount } from '@renderer/components/TextEditorWithCount'
import { DEFAULT_PREFERENCES } from '@shared/preferences'

/** 横向缩放档位上下限。1 = 自适应铺满宽度；超过 1 = 内容比可视区宽 */
const ZOOM_H_MIN = 1
const ZOOM_H_MAX = 32
/** 纵向缩放档位上下限。1 = 默认振幅；< 1 压低、> 1 拉高 */
const ZOOM_V_MIN = 0.25
const ZOOM_V_MAX = 8

function clampZoomH(z: number): number {
  return Math.max(ZOOM_H_MIN, Math.min(ZOOM_H_MAX, z))
}
function clampZoomV(z: number): number {
  return Math.max(ZOOM_V_MIN, Math.min(ZOOM_V_MAX, z))
}

/**
 * SegmentTimelineView — 当前选中 Segment 的「细节 + 时间轴」面板。
 *
 * 内容（从上到下）：
 *   1. Segment 控制条（上下句 / Take 切换 / 播放停止 / 录音重录）
 *   2. 可编辑文案 textarea
 *   3. 当前 Take 的波形
 *
 * 这个面板聚焦「一句话」的维度，和 ProjectTimelineView 的「整个项目」维度
 * 是两个正交的视角。两边都可以独立 dock / 调尺寸 / 显示隐藏。
 *
 * 与 Inspector 的关系：
 *   - Inspector 管元信息（顺序、Take 列表、删除 Segment）
 *   - SegmentTimeline 管「时间维度的内容」（波形 + 播放控制 + 文案）
 *   - 两处都能编辑文案，通过共享 editSegmentText action 天然同步
 */

function IconButton({
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
        'flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted',
        'disabled:cursor-not-allowed disabled:opacity-40',
        !disabled && !active && 'hover:bg-chrome-hover hover:text-fg',
        active && !danger && 'bg-accent text-white',
        active && danger && 'bg-rec text-white'
      )}
    >
      {children}
    </button>
  )
}

/**
 * 单一缩放控件组：缩小 / 重置 / 放大 / 数值。横向 H、纵向 V 共用同一组件
 */
function ZoomGroup({
  axis,
  zoom,
  min,
  max,
  onZoomChange,
  iconOut,
  iconIn,
  hint
}: {
  axis: 'H' | 'V'
  zoom: number
  min: number
  max: number
  onZoomChange: (next: number) => void
  iconOut: React.ReactNode
  iconIn: React.ReactNode
  hint: { out: string; reset: string; in: string }
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-0.5 rounded-sm border border-border bg-bg-deep p-0.5">
      <IconButton title={hint.out} onClick={() => onZoomChange(zoom / 1.5)} disabled={zoom <= min}>
        {iconOut}
      </IconButton>
      <IconButton title={hint.reset} onClick={() => onZoomChange(1)} disabled={zoom === 1}>
        <Maximize2 size={11} />
      </IconButton>
      <IconButton title={hint.in} onClick={() => onZoomChange(zoom * 1.5)} disabled={zoom >= max}>
        {iconIn}
      </IconButton>
      <span className="px-1 font-mono text-2xs tabular-nums text-fg-dim">
        {zoom >= 1 ? zoom.toFixed(1) : zoom.toFixed(2)}
        {axis}
      </span>
    </div>
  )
}

function SegmentControlRow({
  zoomH,
  zoomV,
  onZoomHChange,
  onZoomVChange
}: {
  zoomH: number
  zoomV: number
  onZoomHChange: (next: number) => void
  onZoomVChange: (next: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const segment = useEditorStore((s) =>
    s.selectedSegmentId ? s.segmentsById[s.selectedSegmentId] : undefined
  )
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const playback = useEditorStore((s) => s.playback)
  const paused = useEditorStore((s) => s.paused)
  const recordingSegmentId = useEditorStore((s) => s.recordingSegmentId)
  const startRecording = useEditorStore((s) => s.startRecordingForSelected)
  const startRerecording = useEditorStore((s) => s.startRerecordingSelected)
  const stopRecording = useEditorStore((s) => s.stopRecordingAndSave)
  const cancelRecording = useEditorStore((s) => s.cancelRecording)
  const playCurrentSegment = useEditorStore((s) => s.playCurrentSegment)
  const stopPlayback = useEditorStore((s) => s.stopPlayback)
  const togglePause = useEditorStore((s) => s.togglePausePlayback)
  const selectSegment = useEditorStore((s) => s.selectSegment)
  const setSelectedTake = useEditorStore((s) => s.setSelectedTake)
  const order = useEditorStore((s) => s.order)
  const takeCount = segment?.takes.length ?? 0

  const isRecordingThis = playback === 'recording' && recordingSegmentId === selectedId
  const isRecordingOther = playback === 'recording' && !isRecordingThis

  const onRecordClick = (): void => {
    if (isRecordingThis) void stopRecording()
    else if (playback === 'idle') void startRecording()
  }

  const onPrevSegment = (): void => {
    if (!selectedId) return
    const idx = order.indexOf(selectedId)
    if (idx > 0) selectSegment(order[idx - 1])
  }
  const onNextSegment = (): void => {
    if (!selectedId) return
    const idx = order.indexOf(selectedId)
    if (idx >= 0 && idx < order.length - 1) selectSegment(order[idx + 1])
  }
  const stepTake = (delta: -1 | 1): void => {
    if (!segment || !selectedId) return
    const idx = segment.takes.findIndex((t) => t.id === segment.selectedTakeId)
    const next = Math.max(0, Math.min(segment.takes.length - 1, (idx < 0 ? 0 : idx) + delta))
    if (next !== idx && segment.takes[next]) {
      setSelectedTake(selectedId, segment.takes[next].id)
    }
  }

  // 布局策略与 ProjectControlRow 对齐：grid `1fr auto 1fr` 让中间控制组在
  // 面板够宽时真正居中（不被左右组宽度差推动）。外层 overflow-x-auto +
  // 内层 min-w-max 在面板被压窄时让所有按钮始终可点（横向滚动而非裁掉）
  return (
    <div className="h-8 min-w-0 shrink-0 overflow-x-auto border-b border-border-subtle bg-bg-panel">
      <div
        className="grid h-full min-w-max items-center gap-2 px-2"
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
      >
        {/* 左：占位，让中间组真正居中（grid 1fr auto 1fr） */}
        <div />

        {/* 中：Segment / Take / 播放 / 录音控制组 */}
        <div className="flex items-center gap-0.5 justify-self-center rounded-sm border border-border bg-bg-deep p-0.5">
          <IconButton
            title={t('timeline.btn_prev_segment')}
            onClick={onPrevSegment}
            disabled={playback !== 'idle' || !selectedId || order.indexOf(selectedId) <= 0}
          >
            <ChevronLeft size={13} />
          </IconButton>
          <IconButton
            title={t('timeline.btn_next_segment')}
            onClick={onNextSegment}
            disabled={
              playback !== 'idle' || !selectedId || order.indexOf(selectedId) >= order.length - 1
            }
          >
            <ChevronRight size={13} />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            title={t('timeline.btn_prev_take')}
            onClick={() => stepTake(-1)}
            disabled={playback !== 'idle' || takeCount < 2}
          >
            <SkipBack size={12} />
          </IconButton>
          <IconButton
            title={t('timeline.btn_next_take')}
            onClick={() => stepTake(1)}
            disabled={playback !== 'idle' || takeCount < 2}
          >
            <SkipForward size={12} />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            title={
              playback === 'segment'
                ? t('timeline.btn_stop_segment')
                : t('timeline.btn_play_segment')
            }
            active={playback === 'segment'}
            disabled={
              playback === 'project' || playback === 'recording' || !segment?.selectedTakeId
            }
            onClick={playback === 'segment' ? stopPlayback : () => void playCurrentSegment()}
          >
            {playback === 'segment' ? <Square size={11} /> : <Play size={12} />}
          </IconButton>
          <IconButton
            title={paused ? t('timeline.btn_resume') : t('timeline.btn_pause')}
            active={paused}
            onClick={togglePause}
            disabled={playback !== 'segment' && playback !== 'project'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </IconButton>
          <IconButton
            title={t('timeline.btn_stop_segment')}
            onClick={stopPlayback}
            disabled={playback === 'idle' || playback === 'recording'}
          >
            <Square size={11} />
          </IconButton>
          <div className="mx-0.5 h-4 w-px bg-border" />
          <IconButton
            title={isRecordingThis ? t('timeline.btn_stop_recording') : t('timeline.btn_record')}
            active={isRecordingThis}
            danger
            disabled={
              isRecordingOther ||
              !selectedId ||
              playback === 'segment' ||
              playback === 'project' ||
              playback === 'countdown'
            }
            onClick={onRecordClick}
          >
            {isRecordingThis ? <Square size={11} /> : <Mic size={12} />}
          </IconButton>
          {isRecordingThis ? (
            // 录音状态机：录音中只允许「停止并保存」（上面的 Square 按钮）和
            // 「停止并取消」（下面的 X 按钮）。重录按钮在录音 / 倒计时中
            // disabled，避免「按重录的瞬间隐式提交并立刻又开一段」这种语义不
            // 清的复合操作
            <IconButton title={t('inspector.btn_cancel')} onClick={() => void cancelRecording()}>
              <X size={12} />
            </IconButton>
          ) : (
            <IconButton
              title={t('timeline.btn_rerecord')}
              disabled={playback !== 'idle' || !segment?.selectedTakeId}
              onClick={() => void startRerecording()}
            >
              <RotateCcw size={12} />
            </IconButton>
          )}
        </div>

        {/* 右：缩放控制组（横向 + 纵向）。横向控制波形 X 轴密度，纵向控制
            振幅高度——两者解耦让用户在低音量录音里既能拉宽看清节选位置、
            也能拉高看到细节波动 */}
        <div className="flex items-center gap-1 justify-self-end">
          <ZoomGroup
            axis="H"
            zoom={zoomH}
            min={ZOOM_H_MIN}
            max={ZOOM_H_MAX}
            onZoomChange={(z) => onZoomHChange(clampZoomH(z))}
            iconOut={<ZoomOut size={12} />}
            iconIn={<ZoomIn size={12} />}
            hint={{
              out: t('timeline.zoom_h_out'),
              reset: t('timeline.zoom_h_reset'),
              in: t('timeline.zoom_h_in')
            }}
          />
          <ZoomGroup
            axis="V"
            zoom={zoomV}
            min={ZOOM_V_MIN}
            max={ZOOM_V_MAX}
            onZoomChange={(z) => onZoomVChange(clampZoomV(z))}
            iconOut={<ChevronsDownUp size={12} />}
            iconIn={<ChevronsUpDown size={12} />}
            hint={{
              out: t('timeline.zoom_v_out'),
              reset: t('timeline.zoom_v_reset'),
              in: t('timeline.zoom_v_in')
            }}
          />
        </div>
      </div>
    </div>
  )
}

function SegmentTextEditor(): React.JSX.Element {
  const { t } = useTranslation()
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const text = useEditorStore((s) =>
    s.selectedSegmentId ? (s.segmentsById[s.selectedSegmentId]?.text ?? '') : ''
  )
  const editSegmentText = useEditorStore((s) => s.editSegmentText)
  const recommendedMaxChars = useEditorStore((s) => s.project?.recommendedMaxChars)
  const align = usePreferencesStore(
    (s) => s.prefs.appearance?.segmentTextAlign ?? DEFAULT_PREFERENCES.appearance!.segmentTextAlign!
  )

  return (
    <div className="shrink-0 border-b border-border-subtle bg-bg px-3 py-2">
      <TextEditorWithCount
        value={text}
        disabled={!selectedId}
        onChange={(v) => selectedId && editSegmentText(selectedId, v)}
        recommendedMaxChars={recommendedMaxChars}
        textAlign={align}
        placeholder={t('timeline.segment_text_placeholder')}
      />
    </div>
  )
}

export function SegmentTimelineView(): React.JSX.Element {
  // 波形 + trim 编辑挂在当前选中 Segment 的当前 Take 上。
  // selector 拆细：filePath / durationMs / trim 各取一份，避免任意字段
  // 变化都让 SegmentTimelineView 整体 re-render
  const selectedId = useEditorStore((s) => s.selectedSegmentId)
  const filePath = useEditorStore((s) => {
    if (!s.selectedSegmentId) return null
    const seg = s.segmentsById[s.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    return take?.filePath ?? null
  })
  const takeDurationMs = useEditorStore((s) => {
    if (!s.selectedSegmentId) return undefined
    const seg = s.segmentsById[s.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    return take?.durationMs
  })
  const takeId = useEditorStore((s) => {
    if (!s.selectedSegmentId) return undefined
    const seg = s.segmentsById[s.selectedSegmentId]
    return seg?.selectedTakeId
  })
  const trimStartMs = useEditorStore((s) => {
    if (!s.selectedSegmentId) return undefined
    const seg = s.segmentsById[s.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    return take?.trimStartMs
  })
  const trimEndMs = useEditorStore((s) => {
    if (!s.selectedSegmentId) return undefined
    const seg = s.segmentsById[s.selectedSegmentId]
    const take = seg?.takes.find((t) => t.id === seg.selectedTakeId)
    return take?.trimEndMs
  })
  const setTakeTrim = useEditorStore((s) => s.setTakeTrim)

  // trim 给 WaveformView 的形态总是「填充后的 startMs / endMs」——视图层
  // 只关心区间，不关心是否「显式 set 过」。setTakeTrim 在 store 层会把
  // 0/duration 等价整段的情况自动清掉字段，所以这里只管按当前位置算
  const trim =
    takeDurationMs !== undefined
      ? {
          startMs: trimStartMs ?? 0,
          endMs: trimEndMs ?? takeDurationMs
        }
      : undefined

  const onTrimChange = (next: { startMs: number; endMs: number } | undefined): void => {
    if (!selectedId || !takeId) return
    setTakeTrim(selectedId, takeId, next)
  }

  // 缩放档位：本地 state（不持久化到 workspace.json）。zoomH 影响波形横向
  // 密度 + trim 拖拽精度；zoomV 影响振幅高度。两个轴独立，因为典型用法
  // 是「先 zoomH 定位起 / 终点，再 zoomV 看振幅细节」这种正交操作
  const [zoomH, setZoomH] = useState(1)
  const [zoomV, setZoomV] = useState(1)

  // 滚轮策略，与 ProjectTimeline 同款：
  //   - Ctrl+Shift+wheel：纵向缩放（振幅）
  //   - Ctrl/Cmd+wheel：横向缩放
  //   - 普通 wheel：横向滚动（zoomH=1 时 inner 与 viewport 等宽，无可滚
  //     内容，浏览器默认行为不会动；zoomH>1 时把 deltaY 当 deltaX 用）
  // 滚动直接写 scrollLeft，不通过 React state——WaveformView 的容器是
  // overflow-x-auto，写完就生效
  const onWaveformWheel = (e: WheelEvent): void => {
    if (e.ctrlKey && e.shiftKey) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      setZoomV((z) => clampZoomV(z * factor))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.0015)
      setZoomH((z) => clampZoomH(z * factor))
      return
    }
    const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY
    if (dx === 0) return
    const target = e.currentTarget as HTMLElement | null
    if (!target) return
    // zoomH=1 时 inner=viewport，没有可滚距离，preventDefault 也无副作用
    e.preventDefault()
    target.scrollLeft += dx
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <SegmentControlRow
        zoomH={zoomH}
        zoomV={zoomV}
        onZoomHChange={setZoomH}
        onZoomVChange={setZoomV}
      />
      <SegmentTextEditor />
      <WaveformView
        filePath={filePath}
        durationMs={takeDurationMs}
        trim={trim}
        onTrimChange={onTrimChange}
        zoomH={zoomH}
        zoomV={zoomV}
        onWheel={onWaveformWheel}
      />
    </div>
  )
}
