import { get, set } from 'idb-keyval'
import type { Settings } from '../types'

const SETTINGS_KEY = 'gutun-blog-app:settings:v1'

/**
 * IndexedDB 在个别环境下可能既不 resolve 也不 reject
 * （例如某些浏览器的隐私模式、以及在无头浏览器里打开数据库请求被挂起）。
 * 这里加一个超时兜底：宁可退回默认设置让 App 先能用，也不要卡在启动画面。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(undefined)
      },
    )
  })
}

export async function loadSettings(): Promise<Partial<Settings> | undefined> {
  return withTimeout(get<Partial<Settings>>(SETTINGS_KEY), 2500)
}

export async function saveSettings(settings: Settings): Promise<void> {
  // 写失败（配额、隐私模式）不影响使用：设置仍然保留在当前会话内存里
  await withTimeout(set(SETTINGS_KEY, settings), 2500)
}

