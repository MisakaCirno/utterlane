/**
 * 历史路径兼容层。
 *
 * editorStore 已经按职责拆到 ./editor/ 目录下的多个 slice 文件，但项目里
 * 大量 `import { useEditorStore } from '@renderer/store/editorStore'` 在用
 * 这个路径。一次性改全所有 import 风险大、diff 噪声大；保留这一行 re-export
 * 让旧路径继续工作，新代码可以直接从 './editor' import。
 */
export {
  useEditorStore,
  sanitizeSegmentText
} from './editor'
