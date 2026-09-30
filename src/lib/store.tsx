import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { loadSettings, saveSettings } from './db'
import { StoreContext } from './store-context'
import type { Store } from './store-context'
import { DEFAULT_SETTINGS } from '../types'
import type { Settings, Toast } from '../types'
import { fetchTaxonomies } from './taxonomy'

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [taxonomies, setTaxonomies] = useState<Store['taxonomies']>({
    categories: [],
    tags: [],
    fetchedAt: null,
  })
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    void (async () => {
      try {
        const stored = await loadSettings()
        if (stored) setSettings((prev) => ({ ...prev, ...stored, token: stored.token ?? '' }))
      } catch {
        // IndexedDB 不可用（隐私模式等）时退回默认值，App 仍可运行
      } finally {
        setHydrated(true)
      }
    })()
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    settings.theme === 'auto' ? (systemDark ? 'dark' : 'light') : settings.theme

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    if (meta) meta.setAttribute('content', resolvedTheme === 'dark' ? '#252627' : '#f8f8f8')
  }, [resolvedTheme])

  const store = useMemo<Store>(() => {
    const pushToast: Store['pushToast'] = (kind, text, action) => {
      const id = Date.now() + Math.random()
      setToasts((prev) => [...prev.slice(-2), { id, kind, text, action }])
      const ttl = kind === 'error' ? 7000 : 4000
      window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl)
    }

    const refreshTaxonomies = async () => {
      const url = settings.siteUrl.trim()
      if (!url) return
      try {
        const data = await fetchTaxonomies(url)
        setTaxonomies({ ...data, fetchedAt: Date.now() })
      } catch {
        // 离线或站点尚未发布时静默失败，分类标签仍可手工输入
      }
    }

    return {
      settings,
      updateSettings: (patch) => {
        setSettings((prev) => {
          const next = { ...prev, ...patch }
          void saveSettings(next)
          return next
        })
      },
      resolvedTheme,
      toasts,
      pushToast,
      dismissToast: (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
      taxonomies,
      refreshTaxonomies,
      online,
    }
  }, [settings, resolvedTheme, toasts, taxonomies, online])

  // 首次载入且已配置站点地址时，拉一次分类/标签候选
  useEffect(() => {
    if (!hydrated) return
    if (taxonomies.fetchedAt) return
    if (!settings.siteUrl.trim()) return
    void store.refreshTaxonomies()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, settings.siteUrl])

  if (!hydrated) {
    return (
      <div className="boot-splash">
        <div className="boot-spinner" />
        <p>正在载入…</p>
      </div>
    )
  }

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
