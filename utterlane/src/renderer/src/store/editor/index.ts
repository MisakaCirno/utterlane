import { create } from 'zustand'
import { INITIAL_DATA, type EditorState } from './types'
import { createLifecycleSlice } from './lifecycle'
import { createWorkspaceSlice } from './workspace'
import { createSegmentsSlice, sanitizeSegmentText } from './segments'
import { createRecordingSlice } from './recording'
import { createPlaybackSlice } from './playback'

/**
 * 编辑器 store 承载「当前打开的工程」的全部内存状态。
 * 工程未打开时 project 为 null，其他字段为空 / 默认，此时 UI 应显示欢迎页。
 *
 * 数据流：
 *   - 打开 / 新建工程：UI 调 window.api.project.{open,new,openPath}，
 *     拿到 ProjectBundle 后调 applyBundle() 灌入 store
 *   - 关闭工程：UI 调 window.api.project.close()，然后 clear()
 *   - 工作区改动（选中 / 滚动 / 缩放）：更新 store 后 send 一份 WorkspaceFile，
 *     main 侧 debounce 保存
 *   - Segments 内容改动（导入 / 编辑文本 / 删除 / 切换当前 Take 等）：
 *     更新 store 后调 scheduleSegmentsSave，200ms debounce 合并连续操作再原子写盘
 *
 * 本 store 不保存偏好类数据（主题、列宽、字体缩放等），那些在 preferencesStore。
 *
 * === 切分 ===
 *
 * 真正的 mutation 实现散布在 ./{lifecycle,workspace,segments,recording,
 * playback}.ts 五个 slice 文件。每个 slice 创建函数接收 (set, get)，返回
 * 一组 action 对象；本文件只负责 spread 组合 + 注入 INITIAL_DATA。
 *
 * 模块级落盘工具（segmentsSaveTimer / scheduleSegmentsSave / pushWorkspace
 * 等）在 ./save.ts，所有 slice 共享同一份。types 在 ./types.ts。
 */

// sanitizeSegmentText 实现已搬到 ./segments.ts，从这里 re-export 兼容旧 import 路径
export { sanitizeSegmentText }

export const useEditorStore = create<EditorState>((set, get) => ({
  ...INITIAL_DATA,
  ...createLifecycleSlice(set, get),
  ...createWorkspaceSlice(set, get),
  ...createSegmentsSlice(set, get),
  ...createRecordingSlice(set, get),
  ...createPlaybackSlice(set, get)
}))
