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

export type ExportAudioOptions = {
  /** 输出采样率（Hz）。和工程采样率不同时由 main 侧重采样器处理 */
  sampleRate: number
  format: ExportSampleFormat
  mode: ExportMode
}

/** 各格式对应的 WAV 头里的 bitsPerSample 字段值，方便 UI 显示 */
export const SAMPLE_FORMAT_BITS: Record<ExportSampleFormat, number> = {
  pcm16: 16,
  pcm24: 24,
  float32: 32
}

/** UI 展示用的常用采样率列表；用户也可以通过工程采样率自动得到「跟随工程」 */
export const COMMON_SAMPLE_RATES = [22050, 44100, 48000, 96000] as const
