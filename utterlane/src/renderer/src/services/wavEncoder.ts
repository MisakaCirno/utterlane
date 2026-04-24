/**
 * 把一段浮点 PCM 编码成 WAV（PCM 16-bit LE）字节流。
 *
 * 只实现最基础的头：RIFF + fmt (PCM) + data，不写任何扩展 chunk。
 * 足以被所有音频软件 / ffmpeg 正确识别。
 *
 * 支持 1 / 2 声道；输入 chunks 是交错的浮点样本
 * （单声道 = [s0, s1, s2, ...]；双声道 = [L0, R0, L1, R1, ...]）。
 */

export function encodeWavFromPcm(
  chunks: Float32Array[],
  sampleRate: number,
  channels: 1 | 2
): ArrayBuffer {
  // 拼接所有 chunk 到一个连续的 Float32Array
  let totalSamples = 0
  for (const c of chunks) totalSamples += c.length
  const pcm = new Float32Array(totalSamples)
  {
    let offset = 0
    for (const c of chunks) {
      pcm.set(c, offset)
      offset += c.length
    }
  }

  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const dataSize = pcm.length * bytesPerSample
  const headerSize = 44

  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  // RIFF header
  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, headerSize + dataSize - 8, true)
  writeAscii(view, 8, 'WAVE')

  // fmt chunk
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)

  // data chunk
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // 浮点 [-1, 1] → 16-bit 有符号整数
  let offset = headerSize
  for (let i = 0; i < pcm.length; i++) {
    // 钳位防止 clipping 过冲引发 wrap-around
    const s = Math.max(-1, Math.min(1, pcm[i]))
    // 负数用 0x8000，正数用 0x7FFF，避免不对称
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return buffer
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}
