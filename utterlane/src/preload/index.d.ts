import type { UtterlaneApi } from './index'

declare global {
  interface Window {
    api: UtterlaneApi
  }
}
