import { SEGMENTS_SCHEMA_VERSION, type SegmentsFile, type WorkspaceFile } from '@shared/project'
import { showError } from '@renderer/store/toastStore'
import i18n from '@renderer/i18n'
import type { EditorState } from './types'

/**
 * 落盘相关的模块级辅助：
 *   - workspace 同步快照 + push（main 侧 debounce 500ms 已足够）
 *   - segments 200ms debounce + 异步原子写
 *
 * 写在模块作用域而不是 store action 里，是为了：
 *   1. 共享一个 segmentsSaveTimer——不管 mutation 来自哪个 slice，多次调用
 *      合并到同一次落盘
 *   2. 避免每次 setState 都重建闭包
 *
 * useEditorStore 通过 lazy import（动态读取 './index'）拿到，避免 save.ts
 * ↔ index.ts 的静态循环依赖在 ESM init 时报错——实际访问只发生在 setTimeout
 * 回调与外部 mutation 的同步触发里，那时 index.ts 已经初始化完成。
 */

// ---------------------------------------------------------------------------
// segments.json：debounce 写盘
// ---------------------------------------------------------------------------

const SEGMENTS_SAVE_DEBOUNCE_MS = 200
let segmentsSaveTimer: ReturnType<typeof setTimeout> | null = null

export function snapshotSegments(state: EditorState): SegmentsFile {
  return {
    schemaVersion: SEGMENTS_SCHEMA_VERSION,
    order: state.order,
    segmentsById: state.segmentsById
  }
}

export function snapshotWorkspace(state: EditorState): WorkspaceFile {
  return {
    schemaVersion: 1,
    selectedSegmentId: state.selectedSegmentId,
    lastPreviewedTakeId: state.lastPreviewedTakeId,
    scriptListScrollTop: state.scriptListScrollTop,
    timelineScrollLeft: state.timelineScrollLeft,
    timelineZoom: state.timelineZoom
  }
}

/**
 * 推送当前 workspace 状态给 main。
 * 没有活动工程时 no-op——切换工程过程中可能被调到。
 */
export function pushWorkspace(state: EditorState): void {
  if (!state.projectPath) return
  window.api.project.saveWorkspace(snapshotWorkspace(state))
}

/**
 * 调度一次 segments.json 落盘：200ms debounce 内多次调用合并。
 * 写盘成功后回填 saved: true（保存期间又被 markDirty 重置过的话保留 false）。
 */
export function scheduleSegmentsSave(): void {
  if (segmentsSaveTimer) clearTimeout(segmentsSaveTimer)
  segmentsSaveTimer = setTimeout(() => {
    segmentsSaveTimer = null
    // 动态 import 解决循环依赖：./index 也 import save.ts
    void import('./index').then(({ useEditorStore }) => {
      const state = useEditorStore.getState()
      if (!state.projectPath) return
      const snapshot = snapshotSegments(state)
      window.api.project.saveSegments(snapshot).then((result) => {
        if (result.ok) {
          // 保存期间如果又有改动，saved 已经被 markDirty 重置为 false，
          // 这里不要覆盖
          if (!segmentsSaveTimer) {
            useEditorStore.setState({ saved: true })
          }
        } else {
          // 工程内容写入失败是严重问题，弹出提示让用户知道
          console.error('[editorStore] saveSegments failed:', result.message)
          showError(
            i18n.t('errors.save_segments_title'),
            i18n.t('errors.save_segments_description', { message: result.message })
          )
        }
      })
    })
  }, SEGMENTS_SAVE_DEBOUNCE_MS)
}

/**
 * 清除待写入的 segments 定时器。仅用于 clear（切换工程）时丢弃 pending 写盘。
 *
 * 不要在普通 mutation 末尾调这个——会让 debounce 失效，每次 mutation 都
 * 立即落盘失去合并意义。
 */
export function cancelPendingSegmentsSave(): void {
  if (segmentsSaveTimer) {
    clearTimeout(segmentsSaveTimer)
    segmentsSaveTimer = null
  }
}

/**
 * 标记 segments 为脏。约定 spread 进 set() 的返回对象里：
 *   set({ ..., ...markDirty() })
 *
 * 包成函数而不是直接 `{ saved: false }` 是为了集中语义：将来如果加上
 * 「dirty 时间戳 / 变更计数」之类的字段，只动这一处
 */
export function markDirty(): { saved: false } {
  return { saved: false }
}
