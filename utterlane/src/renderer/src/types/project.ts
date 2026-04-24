// 工程数据模型统一从 @shared 导出，renderer 端只保留 UI 级状态类型。
export type { Project, Segment, Take } from '@shared/project'

/** 播放 / 录音的互斥状态机，仅 renderer 本地使用 */
export type PlaybackMode = 'idle' | 'segment' | 'project' | 'recording'
