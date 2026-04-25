import { promises as fs } from 'fs'
import type { ExportSampleFormat } from '@shared/export'

/**
 * WAV 文件读 / 写 / 编解码工具集。
 *
 * 三层抽象：
 *   - 字节级：readWav / buildWavFile —— 处理 RIFF 容器
 *   - 编解码：decodeWavToFloat32 / encodeFloat32 —— PCM 字节 ↔ Float32 数组
 *   - 拼接级：buildWavFromChannels —— 一站式从 Float32 数据出 WAV 二进制
 *
 * 浮点中间表示：所有重采样 / 拼接都在 Float32 [-1, 1] 上完成，避免
 * 多步定点运算累积量化误差，也方便不同位深之间互转。
 */

// ---------------------------------------------------------------------------
// 字节级：解析 WAV 头
// ---------------------------------------------------------------------------

/**
 * 读取一个 WAV 文件。容忍 fmt / data 之间夹其他 chunk（LIST / INFO 等）。
 * 支持的 format code：
 *   - 1 = PCM（int16 / int24）
 *   - 3 = IEEE_FLOAT（float32）
 * 其他格式（A-law / μ-law / 压缩 WAV）一律抛错。
 */
export type WavInfo = {
  sampleRate: number
  channels: number
  bitsPerSample: number
  /** 1 = PCM 整数；3 = IEEE 浮点 */
  formatCode: 1 | 3
  /** PCM 数据字节（不含头） */
  pcm: Buffer
}

export async function readWav(filePath: string): Promise<WavInfo> {
  const buf = await fs.readFile(filePath)

  if (buf.slice(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error(`不是有效 WAV：${filePath}（缺少 RIFF 头）`)
  }
  if (buf.slice(8, 12).toString('ascii') !== 'WAVE') {
    throw new Error(`不是有效 WAV：${filePath}（缺少 WAVE 标识）`)
  }

  let offset = 12
  let formatCode = 0
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let pcmStart = -1
  let pcmLen = 0

  while (offset + 8 <= buf.length) {
    const chunkId = buf.slice(offset, offset + 4).toString('ascii')
    const chunkSize = buf.readUInt32LE(offset + 4)
    const payloadStart = offset + 8

    if (chunkId === 'fmt ') {
      formatCode = buf.readUInt16LE(payloadStart)
      channels = buf.readUInt16LE(payloadStart + 2)
      sampleRate = buf.readUInt32LE(payloadStart + 4)
      bitsPerSample = buf.readUInt16LE(payloadStart + 14)
    } else if (chunkId === 'data') {
      pcmStart = payloadStart
      pcmLen = chunkSize
      break
    }
    // chunk 按 2 字节对齐
    offset = payloadStart + chunkSize + (chunkSize & 1)
  }

  if (pcmStart < 0 || !sampleRate || !channels || !bitsPerSample) {
    throw new Error(`WAV 文件缺少必要字段：${filePath}`)
  }
  if (formatCode !== 1 && formatCode !== 3) {
    throw new Error(`不支持的 WAV 编码格式 ${formatCode}（只支持 PCM 与 IEEE float）：${filePath}`)
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    formatCode: formatCode as 1 | 3,
    pcm: buf.slice(pcmStart, pcmStart + pcmLen)
  }
}

// ---------------------------------------------------------------------------
// 编解码：PCM 字节 ↔ Float32 数组
// ---------------------------------------------------------------------------

/**
 * 把 readWav 拿到的 PCM 字节按声道拆开成 Float32Array[]，每个数组覆盖一个声道
 * 的全部样本，归一化到 [-1, 1]。
 *
 * 支持源格式：int16 / int24 / float32。其他位深抛错——目前没有真实场景
 * （我们只录 16-bit），等真有需求再补。
 */
export function decodeWavToFloat32(info: WavInfo): Float32Array[] {
  const { pcm, channels, bitsPerSample, formatCode } = info
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = channels * bytesPerSample
  const totalFrames = Math.floor(pcm.length / blockAlign)

  const out: Float32Array[] = []
  for (let c = 0; c < channels; c++) out.push(new Float32Array(totalFrames))

  if (formatCode === 1 && bitsPerSample === 16) {
    for (let i = 0; i < totalFrames; i++) {
      for (let c = 0; c < channels; c++) {
        const s = pcm.readInt16LE(i * blockAlign + c * 2)
        out[c][i] = s / 32768
      }
    }
  } else if (formatCode === 1 && bitsPerSample === 24) {
    for (let i = 0; i < totalFrames; i++) {
      for (let c = 0; c < channels; c++) {
        const off = i * blockAlign + c * 3
        // 3 字节 LE 拼成 24-bit 有符号整数
        let s = pcm[off] | (pcm[off + 1] << 8) | (pcm[off + 2] << 16)
        if (s & 0x800000) s |= ~0xffffff // 符号扩展到 32-bit
        out[c][i] = s / 8388608
      }
    }
  } else if (formatCode === 3 && bitsPerSample === 32) {
    for (let i = 0; i < totalFrames; i++) {
      for (let c = 0; c < channels; c++) {
        out[c][i] = pcm.readFloatLE(i * blockAlign + c * 4)
      }
    }
  } else {
    throw new Error(`不支持的 WAV 位深 / 编码组合：${bitsPerSample}-bit format=${formatCode}`)
  }

  return out
}

/**
 * 多声道 Float32 → 交织 PCM 字节。
 *
 * 削顶：所有格式都先 clamp 到 [-1, 1]，再按目标格式量化。
 * 16-bit / 24-bit 用对称范围（-2^(N-1) ~ 2^(N-1)-1），负向少 1 个量级
 * 以匹配 two's complement 的物理表示。Voice 信号几乎不会触底，听感差异不可闻。
 */
export function encodeFloat32ToPcm(channels: Float32Array[], format: ExportSampleFormat): Buffer {
  const numCh = channels.length
  if (numCh === 0) return Buffer.alloc(0)
  const numFrames = channels[0].length
  // 长度不一致时取最短，避免越界（实际不会发生，因为重采样后各声道等长）
  let frames = numFrames
  for (let c = 1; c < numCh; c++) frames = Math.min(frames, channels[c].length)

  if (format === 'pcm16') {
    const buf = Buffer.alloc(frames * numCh * 2)
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = channels[c][i]
        if (s > 1) s = 1
        else if (s < -1) s = -1
        // 负向乘 32768，正向乘 32767：对应 int16 的实际可表示范围
        const q = Math.round(s < 0 ? s * 32768 : s * 32767)
        buf.writeInt16LE(q, (i * numCh + c) * 2)
      }
    }
    return buf
  }

  if (format === 'pcm24') {
    const buf = Buffer.alloc(frames * numCh * 3)
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = channels[c][i]
        if (s > 1) s = 1
        else if (s < -1) s = -1
        let q = Math.round(s < 0 ? s * 8388608 : s * 8388607)
        if (q < 0) q += 0x1000000 // 24-bit two's complement
        const off = (i * numCh + c) * 3
        buf[off] = q & 0xff
        buf[off + 1] = (q >> 8) & 0xff
        buf[off + 2] = (q >> 16) & 0xff
      }
    }
    return buf
  }

  if (format === 'float32') {
    const buf = Buffer.alloc(frames * numCh * 4)
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numCh; c++) {
        buf.writeFloatLE(channels[c][i], (i * numCh + c) * 4)
      }
    }
    return buf
  }

  // 不应到达：format 是 string union，TS 已经检查了所有分支
  throw new Error(`未知导出格式：${format as string}`)
}

// ---------------------------------------------------------------------------
// 字节级：组装完整 WAV
// ---------------------------------------------------------------------------

/**
 * 用已经编码好的 PCM 字节 + 头部信息组装 WAV 文件。
 *
 * format 决定 fmt chunk 里的 audio format code：1 = PCM，3 = IEEE float。
 * 这里没用 fmt 的扩展字段（cbSize），16 字节标准 fmt chunk 兼容性最好。
 */
export function buildWavFile(params: {
  sampleRate: number
  channels: number
  format: ExportSampleFormat
  pcmData: Buffer
}): Buffer {
  const { sampleRate, channels, format, pcmData } = params
  const bitsPerSample = format === 'pcm16' ? 16 : format === 'pcm24' ? 24 : 32
  const formatCode = format === 'float32' ? 3 : 1
  const bytesPerSample = bitsPerSample / 8
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const dataSize = pcmData.length
  const headerSize = 44

  const header = Buffer.alloc(headerSize)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(headerSize + dataSize - 8, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(formatCode, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, pcmData])
}

/**
 * 一站式：多声道 Float32（已经处于目标采样率）→ 完整 WAV 二进制。
 * 大多数调用方用这个就够了；前面的 encode + buildWavFile 是给需要分段处理
 * 的场景留的下层接口。
 */
export function buildWavFromChannels(params: {
  sampleRate: number
  format: ExportSampleFormat
  channels: Float32Array[]
}): Buffer {
  const { sampleRate, format, channels } = params
  const pcmData = encodeFloat32ToPcm(channels, format)
  return buildWavFile({
    sampleRate,
    channels: channels.length,
    format,
    pcmData
  })
}

// ---------------------------------------------------------------------------
// 兼容入口：保留旧 writeWav 给可能没改完的调用点（目前已无）
// ---------------------------------------------------------------------------
