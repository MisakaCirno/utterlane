import { promises as fs } from 'fs'

/**
 * 读取一个 WAV 文件，返回 PCM 载荷（不含 RIFF 头）+ 基本参数。
 *
 * 只解析我们自己写出的「标准 PCM WAV」：RIFF / fmt / data 三段。
 * 容忍 fmt 和 data 中间有其他 chunk（有些软件会插 LIST）。
 */
export type WavInfo = {
  sampleRate: number
  channels: number
  bitsPerSample: number
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
      // PCM 格式字段
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

  return {
    sampleRate,
    channels,
    bitsPerSample,
    pcm: buf.slice(pcmStart, pcmStart + pcmLen)
  }
}

/**
 * 拼接多段 PCM（相同 sampleRate / channels / bitsPerSample）成一个新的 WAV 文件。
 * 调用方负责验证参数一致性；不一致时直接抛错让用户重新调整工程设置。
 */
export function writeWav(params: {
  sampleRate: number
  channels: number
  bitsPerSample: number
  pcmSegments: Buffer[]
}): Buffer {
  const { sampleRate, channels, bitsPerSample, pcmSegments } = params
  const bytesPerSample = bitsPerSample / 8
  const byteRate = sampleRate * channels * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const dataSize = pcmSegments.reduce((sum, s) => sum + s.length, 0)
  const headerSize = 44

  const header = Buffer.alloc(headerSize)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(headerSize + dataSize - 8, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataSize, 40)

  return Buffer.concat([header, ...pcmSegments])
}
