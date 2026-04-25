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
 *
 * === 行尾用 CRLF ===
 *
 * SubRip 规范要求 \r\n。多数播放器（VLC / mpv / ffmpeg）也接受 \n，但
 * Aegisub 早期版本 / 部分硬件解码器（DVD 字幕硬字幕烧录工具）严格要求
 * CRLF——为了最大兼容性统一用 \r\n。
 *
 * === 文本内不允许空行 ===
 *
 * SRT 用「空行」做条目边界。如果 segment.text 自己包含空行（即两个连续
 * \n），解析器会把后半截当成新条目的 index 来读，结果错位甚至崩溃。
 * 当前 sanitizeSegmentText 已把 \r / \n / \t 折成空格，所以到这里的
 * text 一定单行；但若未来允许多行 segment text，必须在这一层显式 escape
 * （把 \n 替换成 \r\n 之外的占位，比如 ' ' 或 '\\n'）。
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

  // CRLF 行尾，规范一致
  return lines.join('\r\n')
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
