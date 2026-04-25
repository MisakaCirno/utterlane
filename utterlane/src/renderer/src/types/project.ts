// 工程数据模型统一从 @shared 导出，renderer 端只保留 UI 级状态类型。
export type { Project, Segment, Take } from '@shared/project'

/**
 * 播放 / 录音的互斥状态机，仅 renderer 本地使用。
 *
 *   - idle：空闲，可以发起任何动作
 *   - segment：正在播放当前 Segment
 *   - project：正在按顺序连读整个工程
 *   - countdown：录音前倒计时阶段（不算 idle，下一步会进 recording；
 *     用户可按 Esc 中止回到 idle）
 *   - recording：录音中
 *
 * countdown 与 recording 一起被各种 UI 守卫视为「忙状态」，禁用 undo / 切段
 * 等动作，避免和录音流程冲突。
 */
export type PlaybackMode = 'idle' | 'segment' | 'project' | 'countdown' | 'recording'
