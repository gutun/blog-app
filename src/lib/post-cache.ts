/**
 * 文章列表的元数据缓存（IndexedDB 持久化）。
 *
 * 目的：回到列表页时**先用缓存秒开**，再在后台增量刷新，
 * 而不是每次都把 160 多篇文章重新读一遍、解析一遍。
 *
 * 增量刷新的依据是 git tree：
 *   - 先取当前分支的 tree sha（1 次请求）
 *   - 与缓存里的 tree sha 相同 → 什么都没变，直接用缓存，0 次解析
 *   - 不同 → 顺着提交历史往前找到缓存里的那棵树，用 `trees/{base}...{head}`
 *     拿到「变了哪些文件」，只重新解析这些文件
 */
import { del, get, set } from 'idb-keyval'
import type { PostSummary } from '../types'

const CACHE_KEY = 'gutun-blog-app:post-cache:v1'
const CACHE_VERSION = 1

/** 单个文件的解析结果 */
export interface PostMetaEntry {
  /** git blob sha：与 tree 里的 sha 比对即可判断这个文件有没有变 */
  blobSha: string
  title: string
  date: string
  categories: string[]
  tags: string[]
  /** 解析成功的时间；解析失败的条目也记下来，避免每次都重试失败的文件 */
  parsedAt: number
}

export interface PostListCache {
  version: number
  /** 缓存对应的仓库标识，换仓库/换目录时自动失效 */
  repoKey: string
  /** 缓存建立时的分支 tree sha */
  treeSha: string
  /** 拉取这个 tree 时用的分支名 */
  branch: string
  /** 文件路径 -> 元数据 */
  entries: Record<string, PostMetaEntry>
  savedAt: number
}

export function repoKeyOf(owner: string, repo: string, postsDir: string): string {
  return `${owner}/${repo}#${postsDir}`
}

export async function loadPostCache(): Promise<PostListCache | null> {
  try {
    const cache = await get<PostListCache>(CACHE_KEY)
    if (!cache || cache.version !== CACHE_VERSION) return null
    if (!cache.treeSha || !cache.entries) return null
    return cache
  } catch {
    return null
  }
}

export async function savePostCache(cache: PostListCache): Promise<void> {
  try {
    await set(CACHE_KEY, cache)
  } catch {
    // 配额/隐私模式下写不进就算了，只影响速度不影响正确性
  }
}

export async function clearPostCache(): Promise<void> {
  try {
    await del(CACHE_KEY)
  } catch {
    // 忽略
  }
}

/** 把缓存内容还原成列表项（用于「秒开」） */
export function postsFromCache(cache: PostListCache, postsDir: string): PostSummary[] {
  const dir = postsDir.replace(/^\/+|\/+$/g, '')
  return Object.entries(cache.entries)
    .map(([path, entry]) => ({
      path,
      name: path.slice(dir.length + 1),
      sha: entry.blobSha,
      title: entry.title,
      date: entry.date,
      loaded: true,
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

/** 缓存的年龄，用于界面提示 */
export function cacheAge(cache: PostListCache): number {
  return Date.now() - cache.savedAt
}
