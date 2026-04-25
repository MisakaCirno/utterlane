/**
 * Dev 模式专用日志工具。
 *
 * `import.meta.env.DEV` 是 Vite 在编译期注入的常量：
 *   - dev（npm run dev）→ true，三个函数照常 console.*
 *   - 打包后（npm run build）→ false，整个 if 分支会被 dead-code 剔除，
 *     调用本身在生产 bundle 里不存在
 *
 * 所以 devLog / devWarn / devError 在生产构建里**完全消失**，
 * 不进 console、不被 electron-log/renderer 转发到 main 日志文件。
 *
 * === 怎么选 console.* vs devLog ===
 *
 * 用 dev*（dev 才输出）：
 *   - 流程追踪（playFile START、IPC 数据大小、状态变化等）
 *   - 防御兜底的非致命告警（AudioContext resume 失败之类）
 *   - 任何「正常运行时也偶发出现」的诊断信息
 *
 * 用普通 console.error / showError / toast / alert（生产也保留 / 可见）：
 *   - 用户可见的操作错误（写盘失败、录音启动失败）
 *   - 关键 IPC 调用错误
 *   - 数据完整性相关错误
 *
 * 后者的目的是用户报 bug 时附上日志能看到——log 文件里有就够，console
 * 里也保留方便实时查看
 */

const DEV = import.meta.env.DEV

export function devLog(...args: unknown[]): void {
  if (DEV) console.log(...args)
}

export function devWarn(...args: unknown[]): void {
  if (DEV) console.warn(...args)
}

export function devError(...args: unknown[]): void {
  if (DEV) console.error(...args)
}
