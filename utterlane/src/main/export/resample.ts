/**
 * 单声道音频重采样：windowed sinc 法。
 *
 * === 为什么自实现而不引第三方库 ===
 *
 * 不想加依赖（license / 体积 / 跨平台）。windowed sinc 在 voice 场景下足够
 * 透明，自己写约 50 行可控。下游真发现质量瓶颈再换 SoX / SRC。
 *
 * === 原理 ===
 *
 * 任意比率重采样的卷积核：
 *
 *   k(t) = sinc(t * cutoff) * window(t / radius)
 *
 *   - sinc(x) = sin(pi*x) / (pi*x)，频率响应为理想低通
 *   - cutoff = min(1, outRate/inRate)：下采样时把低通截止压到新 Nyquist
 *     避免混叠；上采样时取 1（输入已经满带宽，不需要二次低通）
 *   - radius：每侧覆盖的输入样本数。基础 8 个 lobe 在 unit ratio 下足够，
 *     下采样比率越大需要越多 lobe 来等效维持同样陡的过渡带，因此把
 *     radius 按 1/cutoff 放大
 *   - window：Hann 窗，平滑到 0，避免截断造成的旁瓣（Gibbs）
 *
 * 边界归一化：靠近输入数组首尾时只有一半 kernel 在范围内，加权和会偏小。
 * 除以本次循环实际累加的权重总和（norm）让边界振幅维持正确。
 */

/** 基础每侧 tap 数（unit ratio 时的 sinc lobe 数）。8 在 voice 场景质量足够 */
const BASE_TAPS = 8

function sinc(x: number): number {
  if (x === 0) return 1
  const px = Math.PI * x
  return Math.sin(px) / px
}

/**
 * Hann 窗。t 归一化到 [-1, 1]，超出范围返回 0。
 * 选 Hann 而不是 Blackman / Kaiser：voice 场景下听感差异极小，但 Hann
 * 没有参数要调，实现最简
 */
function hann(t: number): number {
  if (t <= -1 || t >= 1) return 0
  return 0.5 * (1 + Math.cos(Math.PI * t))
}

/**
 * 单声道重采样。inRate === outRate 时直接返回原数组（同引用，调用方注意
 * 不要回写）。
 *
 * 输出长度 = round(inLen * outRate/inRate)，少一两个样本不要紧——拼接时
 * 累计误差对 voice 场景不可闻。
 */
export function resampleMono(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate === outRate) return input
  if (input.length === 0) return new Float32Array(0)

  const ratio = outRate / inRate
  // cutoff 控制低通截止；下采样时 < 1 用来防混叠
  const cutoff = Math.min(1, ratio)
  // 下采样时按 1/cutoff 增加 tap 数，保持等效过渡带宽度
  const taps = Math.ceil(BASE_TAPS / cutoff)
  const inLen = input.length
  const outLen = Math.max(1, Math.round(inLen * ratio))
  const out = new Float32Array(outLen)

  for (let i = 0; i < outLen; i++) {
    // 输出样本 i 对应的输入位置（小数）
    const center = i / ratio
    const i0 = Math.floor(center)
    let sum = 0
    let norm = 0

    for (let k = -taps + 1; k <= taps; k++) {
      const n = i0 + k
      if (n < 0 || n >= inLen) continue
      const dx = n - center
      // sinc 参数用 dx*cutoff（下采样时压缩）
      // window 参数用 dx/taps（在 [-1,1] 之间归一化）
      const w = sinc(dx * cutoff) * hann(dx / taps)
      sum += input[n] * w
      norm += w
    }

    out[i] = norm > 0 ? sum / norm : 0
  }

  return out
}

/**
 * 多声道（deinterleaved）重采样：对每个声道独立调用 resampleMono。
 * 输入 / 输出都是 channels × samples 的形式。
 */
export function resampleChannels(
  channels: Float32Array[],
  inRate: number,
  outRate: number
): Float32Array[] {
  if (inRate === outRate) return channels
  return channels.map((ch) => resampleMono(ch, inRate, outRate))
}
