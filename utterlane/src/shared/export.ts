/**
 * 导出选项的共享类型。
 *
 * 落盘格式说明：
 *   - pcm16：标准 16-bit PCM，兼容性最好，绝大多数视频编辑器 / 媒体播放器
 *     都吃这一种
 *   - pcm24：24-bit PCM，比 16-bit 多 8 dB 动态范围，专业音频后期常用
 *   - float32：IEEE 754 单精度浮点，DAW 友好，无削顶失真，但文件大一倍
 *
 * 模式说明：
 *   - concat：所有 Segment 拼成一个 WAV 文件
 *   - split：每个有 selectedTakeId 的 Segment 单独导出一个 WAV 文件
 */

export type ExportSampleFormat = 'pcm16' | 'pcm24' | 'float32'
export type ExportMode = 'concat' | 'split'

/**
 * 导出后处理效果集合。所有字段可选——未来加 LUFS 归一 / 限幅 / EQ 时
 * 直接往这个对象里加字段，IPC 协议 / UI 字段都会自然扩展。
 */
export type ExportEffects = {
  /** 段间静音填充（毫秒），0 / undefined = 不填 */
  silencePaddingMs?: number
  /** 峰值归一化的目标 dB（≤ 0），undefined = 不归一化 */
  peakNormalizeDb?: number
}

export type ExportAudioOptions = {
  /** 输出采样率（Hz）。和工程采样率不同时由 main 侧重采样器处理 */
  sampleRate: number
  format: ExportSampleFormat
  mode: ExportMode
  /**
   * 后处理效果。可选——不传等于全部关闭。
   * 拼接模式下：silence 在段间插入，归一化作用于整体；
   * 拆分模式下：silence 不生效（各段独立文件，没有「段间」概念），
   * 归一化用所有段的统一 gain factor 保持响度关系
   */
  effects?: ExportEffects
}

/** 各格式对应的 WAV 头里的 bitsPerSample 字段值，方便 UI 显示 */
export const SAMPLE_FORMAT_BITS: Record<ExportSampleFormat, number> = {
  pcm16: 16,
  pcm24: 24,
  float32: 32
}

/** UI 展示用的常用采样率列表；用户也可以通过工程采样率自动得到「跟随工程」 */
export const COMMON_SAMPLE_RATES = [22050, 44100, 48000, 96000] as const
