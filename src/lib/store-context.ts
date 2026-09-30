import { createContext, useContext } from 'react'
import type { Settings, Toast, ToastKind } from '../types'

export interface Store {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  /** 实际的浅色/暗色（theme = auto 时跟随系统） */
  resolvedTheme: 'light' | 'dark'
  toasts: Toast[]
  pushToast: (kind: ToastKind, text: string, action?: Toast['action']) => void
  dismissToast: (id: number) => void
  /** 分类 / 标签候选，来自线上站点的 taxonomy 页面 */
  taxonomies: { categories: string[]; tags: string[]; fetchedAt: number | null }
  refreshTaxonomies: () => Promise<void>
  online: boolean
}

export const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore 必须在 StoreProvider 内部使用')
  return store
}
