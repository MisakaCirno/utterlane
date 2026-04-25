/**
 * 音频电平相关的纯计算工具，独立于 UI / 状态。
 *
 * dBFS（dB Full Scale）：以「数字音频满刻度」为参考的 dB 值。
 *   - RMS = 1.0  → 0 dBFS（满刻度）
 *   - RMS = 0.5  → ≈ -6 dBFS
 *   - RMS = 0.1  → -20 dBFS
 *   - RMS = 0    → -∞
 *
 * 我们对 RMS 取对数后映射到一个 [floor, 0] dB 的区间，再线性归一化为
 * [0, 1] 的 fill 比例——这是音频界标准做法，比直接 RMS×2 更接近人耳
 * 的响度感受。
 */

/** 显示用 dB 下限：低于此值视作「等同静音」，bar 填充为 0 */
export const LEVEL_DB_FLOOR = -60

/** 显示用 dB 上限。0 dBFS = 数字满刻度 */
export const LEVEL_DB_CEIL = 0

/** RMS 视为静音的阈值。低于这个值 amplitudeToDb 直接返回 -Infinity */
const SILENCE_THRESHOLD = 1e-6

/**
 * RMS（[0, 1] 浮点）→ dBFS。
 * 静音返回 -Infinity，调用方按需要显示 "-∞" 或就地 clamp。
 */
export function amplitudeToDb(rms: number): number {
  if (rms <= SILENCE_THRESHOLD) return -Infinity
  return 20 * Math.log10(Math.min(1, rms))
}

/**
 * 把 dB 值映射到 [0, 1] 的 bar 填充比例。
 *   - dB <= floor → 0
 *   - dB >= ceil  → 1
 *   - 其余线性
 *
 * floor / ceil 默认走模块常量，调用方一般不用传
 */
export function dbToFill(
  db: number,
  floor: number = LEVEL_DB_FLOOR,
  ceil: number = LEVEL_DB_CEIL
): number {
  if (!Number.isFinite(db)) return 0
  if (db <= floor) return 0
  if (db >= ceil) return 1
  return (db - floor) / (ceil - floor)
}

/**
 * RMS → fill 比例，组合上面两步。等同于 dbToFill(amplitudeToDb(rms))，
 * 但跳过中间步骤更直观
 */
export function amplitudeToFill(rms: number): number {
  return dbToFill(amplitudeToDb(rms))
}

/**
 * 显示用 dB 文本。-Infinity → "-∞ dB"，否则保留 1 位小数。
 * tabular-nums 字体下宽度稳定，便于 UI 不抖动
 */
export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '-∞ dB'
  return `${db.toFixed(1)} dB`
}
