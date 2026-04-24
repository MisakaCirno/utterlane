import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { zhCN } from './locales/zh-CN'
import { enUS } from './locales/en-US'
import { DEFAULT_PREFERENCES } from '@shared/preferences'

/**
 * i18n 初始化。
 *
 * 资源内嵌：MVP 阶段两种语言都装进 bundle，不走后端加载——
 * 相比分离加载，省掉了一次 fetch / 异步等待，在没有网络情况下也能用。
 * 将来如果文案量大到影响首包尺寸，再拆 namespace 按需加载。
 *
 * 初始语言来自 DEFAULT_PREFERENCES；真实用户偏好 hydrate 之后，
 * App 会显式调用 changeLanguage() 切到对应值。
 */

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    'en-US': { translation: enUS }
  },
  lng: DEFAULT_PREFERENCES.appearance?.locale ?? 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    // React 自带 XSS 防护，i18next 的转义会干扰 <strong> 这类自带标签，
    // 我们在 <Trans> 组件里处理富文本
    escapeValue: false
  },
  returnNull: false
})

export default i18n
