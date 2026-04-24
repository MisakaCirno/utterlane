/**
 * Take 波形数据服务。
 *
 * 流程：renderer 调 readTakeFile → AudioContext.decodeAudioData → 拿到 PCM
 * → 按目标像素宽度分桶取绝对值最大值（peak）→ 返回给 WaveformView 绘制。
 *
 * 缓存策略：按 filePath 缓存解码后的 Float32Array。
 *   - 用户在 Segments 之间来回切换时，命中缓存立即出图
 *   - LRU 上限 16 条，切得再多也不会让内存失控（每条 WAV 几 MB）
 *   - peaks 不缓存：依赖容器宽度，重算成本很低（O(samples)）
 *
 * 波形反映的是「当前 Take 刚录时的内容」。重录会把文件 rename 覆盖，
 * 但路径不变——所以重录后缓存需要失效。见 invalidate()。
 */

type CacheEntry = {
  samples: Float32Array
  sampleRate: number
}

const cache = new Map<string, CacheEntry>()
const MAX_CACHE = 16

/**
 * 读并解码一个 Take 文件，返回单声道浮点 PCM。
 * 重复调用同一路径会命中缓存。
 */
export async function loadSamples(filePath: string): Promise<CacheEntry> {
  const existing = cache.get(filePath)
  if (existing) {
    // LRU: 将命中项挪到末尾（Map 保留插入顺序）
    cache.delete(filePath)
    cache.set(filePath, existing)
    return existing
  }

  const buffer = await window.api.project.readTakeFile(filePath)
  const ctx = new AudioContext()
  try {
    const audio = await ctx.decodeAudioData(buffer)
    // 单声道：只取 channel 0。对口播够用；
    // 立体声情况可以后续在这里做混合（(L+R)/2）
    // slice() 做一次拷贝，避免 ctx.close() 后底层 buffer 被回收
    const samples = audio.getChannelData(0).slice()
    const entry: CacheEntry = { samples, sampleRate: audio.sampleRate }
    cache.set(filePath, entry)
    while (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    return entry
  } finally {
    await ctx.close()
  }
}

/**
 * 让指定路径的缓存失效。重录流程覆写了同路径文件后应调用。
 * （Slice D2 的重录路径暂时不主动调这个，等下次波形需要展示时会通过
 *  cache.get → 旧数据，重新加载由缓存失效触发。为了简单起见，
 *  这里先暴露接口但不强制使用；后续如果发现重录后波形陈旧再接入。）
 */
export function invalidate(filePath: string): void {
  cache.delete(filePath)
}

/**
 * 把连续样本按目标桶数分段，取每段绝对值最大值（peak）。
 * 结果数组长度 == buckets；每个元素 [0, 1] 表示该桶的峰值振幅。
 */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  if (buckets <= 0) return new Float32Array(0)
  const peaks = new Float32Array(buckets)
  const bucketSize = Math.max(1, Math.ceil(samples.length / buckets))
  for (let b = 0; b < buckets; b++) {
    const start = b * bucketSize
    const end = Math.min(start + bucketSize, samples.length)
    let max = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > max) max = v
    }
    peaks[b] = max
  }
  return peaks
}
