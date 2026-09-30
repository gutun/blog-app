import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Service Worker 注册与「新版本可用」提示。
 *
 * 这里自己接管注册，而不是用 vite-plugin-pwa 的 useRegisterSW，原因：
 * 那个 hook 在「首次安装」和「已有 worker 在等待」这几种状态下的边界处理
 * 会让人看到一条永远消不掉的「有新版本可用」横幅。
 *
 * 本实现的判定规则很简单，只有同时满足才提示：
 *   1. 页面上已经有一个在控制它的 SW（说明不是首次安装）
 *   2. 出现了 waiting 状态的新 SW（说明确实装了新版本）
 *   3. 用户这次会话还没点过「稍后」
 * 另外每 30 分钟才主动探测一次更新，避免频繁打扰。
 */

const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000
const SNOOZE_KEY = 'gutun-blog-app:sw-snooze'

type Status = 'idle' | 'offline-ready' | 'update-ready'

export interface ServiceWorkerState {
  /** 是否已经可以离线使用 */
  offlineReady: boolean
  /** 是否有真正的新版本在等待激活 */
  updateReady: boolean
  /** 立即更新并刷新页面 */
  applyUpdate: () => void
  /** 稍后再说：本次会话不再提示 */
  snooze: () => void
}

const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator

export function useServiceWorker(): ServiceWorkerState {
  const [status, setStatus] = useState<Status>('idle')
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)
  const reloadingRef = useRef(false)

  const applyUpdate = useCallback(() => {
    const waiting = registrationRef.current?.waiting
    if (!waiting) {
      setStatus('idle')
      return
    }
    reloadingRef.current = true
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        if (reloadingRef.current) window.location.reload()
      },
      { once: true },
    )
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }, [])

  const snooze = useCallback(() => {
    setStatus('idle')
    try {
      sessionStorage.setItem(SNOOZE_KEY, '1')
    } catch {
      // 忽略
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    let cancelled = false

    const shouldPrompt = (registration: ServiceWorkerRegistration): boolean => {
      // 没有 controller ⇒ 这次是首次安装，不是「有新版本」
      if (!navigator.serviceWorker.controller) return false
      // 本次会话已经点过「稍后」
      try {
        if (sessionStorage.getItem(SNOOZE_KEY) === '1') return false
      } catch {
        // 忽略
      }
      return Boolean(registration.waiting)
    }

    const evaluate = (registration: ServiceWorkerRegistration) => {
      if (cancelled) return
      if (shouldPrompt(registration)) setStatus('update-ready')
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register(
          `${import.meta.env.BASE_URL}sw.js`,
        )
        if (cancelled) return
        registrationRef.current = registration

        // 上次访问时已经有新版本在等待
        evaluate(registration)

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') evaluate(registration)
          })
        })

        // 首次安装完成后，让用户知道可以离线用了（一次性提示）
        if (!navigator.serviceWorker.controller) {
          navigator.serviceWorker.ready.then(() => {
            if (!cancelled && navigator.serviceWorker.controller) setStatus('idle')
          })
        }
      } catch {
        // 注册失败（例如不支持 SW 的浏览器）不影响其它功能
      }
    }

    void register()

    // 低频主动检查，避免每次切回前台都打扰
    const timer = window.setInterval(() => {
      void registrationRef.current?.update()
    }, UPDATE_CHECK_INTERVAL)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void registrationRef.current?.update()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return {
    offlineReady: status === 'offline-ready',
    updateReady: status === 'update-ready',
    applyUpdate,
    snooze,
  }
}
