import type { SegmentsFile } from '@shared/project'

/**
 * 按 order + selectedTakeId 生成 SRT 字幕内容。
 *
 * SRT 时间格式：HH:MM:SS,mmm
 * 每一条字幕：
 *   <index>
 *   <start> --> <end>
 *   <text>
 *   <empty line>
 *
 * 规则（对齐 docs/utterlane.md#字幕规则）：
 *   - 字幕文本直接用 segment.text
 *   - 一个 Segment 对应一条字幕
 *   - 时间按当前 Take 的时长顺序累加
 *   - 没有 selectedTakeId 的 Segment 跳过（和导出音频时的跳过规则一致）
 */
export function buildSrt(segments: SegmentsFile): string {
  const lines: string[] = []
  let cursor = 0 // 累计毫秒
  let index = 1

  for (const segId of segments.order) {
    const seg = segments.segmentsById[segId]
    if (!seg || !seg.selectedTakeId) continue
    const take = seg.takes.find((t) => t.id === seg.selectedTakeId)
    if (!take) continue

    const start = cursor
    const end = cursor + take.durationMs
    cursor = end

    lines.push(String(index))
    lines.push(`${formatSrtTime(start)} --> ${formatSrtTime(end)}`)
    lines.push(seg.text)
    lines.push('')
    index++
  }

  // 末尾留一个空行；多数播放器能容忍也能接受
  return lines.join('\n')
}

function formatSrtTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return (
    String(hours).padStart(2, '0') +
    ':' +
    String(minutes).padStart(2, '0') +
    ':' +
    String(seconds).padStart(2, '0') +
    ',' +
    String(millis).padStart(3, '0')
  )
}
