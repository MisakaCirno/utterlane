/**
 * 导出后处理工具集。
 *
 * === 设计意图 ===
 *
 * 把所有导出阶段「修改 Float32 样本」的操作集中放在这里，让 ipc.ts 的
 * 编排逻辑只负责「在合适的时机调谁」。
 *
 * 当前实现的两类效果：
 *   - 静音填充：每段之间插入 N ms 的静音（拼接模式）
 *   - 峰值归一化：把整个项目的峰值缩放到目标 dB
 *
 * === 后续接入 LUFS / 其他效果 ===
 *
 * 准备扩展更复杂的后处理（LUFS 归一化、限幅器、EQ）时，建议沿用「无副作用
 * 工具函数」的风格往这里加，由 ipc.ts 决定调用顺序。如果效果数量增长到
 * ipc.ts 编排逻辑变冗长，再考虑抽成 Pipeline 抽象（一组 step，每 step
 * 拿走 channels 改完再返回）。现在两条不值得为了「将来可扩展」就上抽象。
 *
 * 所有函数都以 deinterleaved Float32Array[] 为标准输入输出形态，和
 * resample.ts / wav.ts 对齐——浮点中间表示能避免多步定点运算累积量化误差。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ExportEffects = {
  /** 段与段之间填充的静音长度（毫秒）。0 / undefined = 不填 */
  silencePaddingMs?: number

  /**
   * 峰值归一化目标（dB，应当 ≤ 0）。undefined = 不做归一化。
   * 例：-3 表示把整个工程峰值压到 0.708（10^(-3/20)）。
   *
   * 「全静音」段（峰值 < 1e-6）跳过，避免除 0 把数值放大成 NaN
   */
  peakNormalizeDb?: number
}

// ---------------------------------------------------------------------------
// 静音 / 拼接
// ---------------------------------------------------------------------------

/**
 * 生成 N ms 的静音 buffer（每个声道都填 0）。
 * 时长用 round 向最近整数样本数取，少 1 个样本不可闻
 */
export function makeSilenceBuffer(
  sampleRate: number,
  channelCount: number,
  durationMs: number
): Float32Array[] {
  const samples = Math.max(0, Math.round((sampleRate * durationMs) / 1000))
  const result: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) result.push(new Float32Array(samples))
  return result
}

/**
 * 拼接所有段成一份长 channels。silenceMs > 0 时在每段后面（最后一段除外）
 * 插入一段静音。
 *
 * 这是拼接模式下的主路径——拆分模式下每段独立写盘，不会经过这里
 */
export function concatWithSilence(
  perItemChannels: Float32Array[][],
  channelCount: number,
  sampleRate: number,
  silenceMs: number
): Float32Array[] {
  if (silenceMs <= 0 || perItemChannels.length <= 1) {
    return concatChannels(perItemChannels, channelCount)
  }
  const silence = makeSilenceBuffer(sampleRate, channelCount, silenceMs)
  // 在每段后面追加 silence，最后一段不追加
  const items: Float32Array[][] = []
  for (let i = 0; i < perItemChannels.length; i++) {
    items.push(perItemChannels[i])
    if (i < perItemChannels.length - 1) items.push(silence)
  }
  return concatChannels(items, channelCount)
}

function concatChannels(items: Float32Array[][], channelCount: number): Float32Array[] {
  const out: Float32Array[] = []
  for (let c = 0; c < channelCount; c++) {
    const total = items.reduce((sum, item) => sum + item[c].length, 0)
    const merged = new Float32Array(total)
    let offset = 0
    for (const item of items) {
      merged.set(item[c], offset)
      offset += item[c].length
    }
    out.push(merged)
  }
  return out
}

// ---------------------------------------------------------------------------
// 峰值归一化
// ---------------------------------------------------------------------------

/** 找出所有声道里的最大绝对值。归一化前的扫描 / 削顶检测都可以用 */
export function findPeakAbs(channels: Float32Array[]): number {
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = ch[i] < 0 ? -ch[i] : ch[i]
      if (a > peak) peak = a
    }
  }
  return peak
}

/** in-place 把所有样本乘以 factor。factor === 1 时跳过避免无谓循环 */
export function applyGain(channels: Float32Array[], factor: number): void {
  if (factor === 1) return
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) ch[i] *= factor
  }
}

/**
 * 把单个 buffer 的峰值归一化到 targetDb。
 * 适用于拼接模式（整个工程作为一个 buffer 一起算）。
 *
 * 对于拆分模式需要跨段一致 gain，应改用 normalizePeakAcrossItems
 */
export function normalizePeak(channels: Float32Array[], targetDb: number): void {
  const peak = findPeakAbs(channels)
  if (peak < 1e-6) return
  const targetLinear = Math.pow(10, targetDb / 20)
  applyGain(channels, targetLinear / peak)
}

/**
 * 跨多段 buffer 的统一峰值归一化。所有段共用一个 gain factor，保留段与
 * 段之间的相对响度关系——这是拆分模式的正确做法。
 *
 * in-place：直接修改入参里的每段 channels
 */
export function normalizePeakAcrossItems(
  perItemChannels: Float32Array[][],
  targetDb: number
): void {
  let globalPeak = 0
  for (const seg of perItemChannels) {
    const p = findPeakAbs(seg)
    if (p > globalPeak) globalPeak = p
  }
  if (globalPeak < 1e-6) return
  const targetLinear = Math.pow(10, targetDb / 20)
  const factor = targetLinear / globalPeak
  for (const seg of perItemChannels) applyGain(seg, factor)
}
