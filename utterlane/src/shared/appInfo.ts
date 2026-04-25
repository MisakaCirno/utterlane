/**
 * 应用 / 运行时元信息。main 与 preload 共享。
 *
 * 全部只读、启动后不变。
 */
export type AppInfo = {
  name: string
  version: string
  homepage: string
  electron: string
  chromium: string
  node: string
  v8: string
  platform: NodeJS.Platform
  arch: string
}
