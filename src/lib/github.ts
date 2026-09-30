/**
 * GitHub REST 客户端。
 *
 * 只做三件事：读取仓库里的文章、用一次 Contents API 调用写入一个文件、把图片写进 static/images。
 * 这样每次发布对 GitHub 来说就是一次普通提交 —— 与你现在 `git push` 的效果完全相同，
 * GitHub Actions 会自动重新构建 GitHub Pages。
 */
import { base64DecodeUtf8, base64EncodeUtf8, wrapBase64 } from '../types'
import type { GitHubUser, PostFile, PostSummary, Settings } from '../types'

const API = 'https://api.github.com'

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

interface RepoInfo {
  defaultBranch: string
  private: boolean
  fullName: string
}

interface TreeEntry {
  path: string
  sha: string
  type: string
  size?: number
}

function headers(token: string): HeadersInit {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function ghFetch<T>(settings: Settings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { ...headers(settings.token), ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { message?: string; documentation_url?: string }
      detail = body.message ?? ''
    } catch {
      detail = await res.text().catch(() => '')
    }
    throw new GitHubError(res.status, explain(res.status, detail))
  }
  return (await res.json()) as T
}

function explain(status: number, detail: string): string {
  switch (status) {
    case 401:
      return 'Token 无效或已过期，请到 GitHub 重新生成后更新设置'
    case 403:
      return `没有权限或触发限流（${detail || 'Forbidden'}）。请确认 Token 勾选了该仓库的 Contents: Read and write`
    case 404:
      return '仓库或文件不存在。请检查用户名 / 仓库名 / 目录是否正确；Token 也必须勾选该仓库'
    case 409:
      return '文件已被其他地方修改（sha 冲突），请下拉刷新后重试'
    case 422:
      return `请求被拒绝（${detail || 'Unprocessable Entity'}）`
    default:
      return `GitHub 返回 ${status}${detail ? `：${detail}` : ''}`
  }
}

const repoPath = (s: Settings) => `/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`

/** 校验 Token 并返回登录用户 */
export async function verifyToken(settings: Settings): Promise<GitHubUser> {
  return ghFetch<GitHubUser>(settings, '/user')
}

/** 读取仓库信息（含默认分支），顺带验证仓库可访问 */
export async function fetchRepo(settings: Settings): Promise<RepoInfo> {
  const repo = await ghFetch<{ default_branch: string; private: boolean; full_name: string }>(
    settings,
    repoPath(settings),
  )
  cache.isPrivate = repo.private
  return {
    defaultBranch: repo.default_branch,
    private: repo.private,
    fullName: repo.full_name,
  }
}

/* ------------------------------------------------------------------ 读取文章 */

interface Cache {
  branch?: string
  /** 仓库是否私有：私有仓库不能用 raw.githubusercontent.com，读取会固定走 API */
  isPrivate?: boolean
  /** path -> sha，便于更新时直接使用，省掉一次额外的 GET */
  shas: Map<string, string>
}

const cache: Cache = { shas: new Map() }

export function invalidateCache(): void {
  cache.branch = undefined
  cache.isPrivate = undefined
  cache.shas.clear()
}

export async function resolveDefaultBranch(settings: Settings): Promise<string> {
  if (cache.branch) return cache.branch
  const repo = await fetchRepo(settings)
  cache.branch = repo.defaultBranch
  return repo.defaultBranch
}

/** 列出 content/posts 下的所有 md 文件（1 次 API 调用） */
export async function listPostFiles(settings: Settings): Promise<PostSummary[]> {
  const branch = await resolveDefaultBranch(settings)
  const dir = settings.postsDir.replace(/^\/+|\/+$/g, '')
  const data = await ghFetch<{ tree: TreeEntry[]; truncated: boolean }>(
    settings,
    `${repoPath(settings)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  )
  const posts = data.tree
    .filter(
      (e) =>
        e.type === 'blob' &&
        e.path.startsWith(`${dir}/`) &&
        /\.(md|markdown)$/i.test(e.path) &&
        !e.path.slice(dir.length + 1).includes('/'),
    )
    .map<PostSummary>((e) => {
      cache.shas.set(e.path, e.sha)
      return {
        path: e.path,
        name: e.path.slice(dir.length + 1),
        sha: e.sha,
        title: '',
        date: '',
        loaded: false,
      }
    })
  return posts
}

function decodeContent(payload: { content?: string; encoding?: string }): string {
  if (!payload.content) return ''
  if (payload.encoding && payload.encoding !== 'base64') return payload.content
  return base64DecodeUtf8(payload.content)
}

/**
 * 读取单个文件。
 * 公开仓库优先走 raw.githubusercontent.com —— 它不消耗 GitHub API 的
 * 5000 次/小时配额，列表页因此可以放心地逐篇读取 front matter。
 * 私有仓库（或 raw 取不到时）再回退到 Contents API。
 */
export async function readFile(settings: Settings, path: string): Promise<PostFile> {
  const branch = await resolveDefaultBranch(settings)
  const name = path.split('/').pop() ?? path

  // 私有仓库不能用 raw，先确认一次（结果会缓存）
  if (cache.isPrivate === undefined) {
    try {
      await fetchRepo(settings)
    } catch {
      // 探测失败就当公开仓库试一次 raw，失败会自动回退到 API
    }
  }

  if (!cache.isPrivate) {
    try {
      const rawUrl = `https://raw.githubusercontent.com/${settings.owner}/${settings.repo}/${encodeURIComponent(
        branch,
      )}/${path.split('/').map(encodeURIComponent).join('/')}`
      const res = await fetch(rawUrl, { cache: 'no-cache' })
      if (res.ok) {
        return {
          path,
          name,
          sha: cache.shas.get(path) ?? '',
          title: '',
          date: '',
          loaded: false,
          content: await res.text(),
        }
      }
    } catch {
      // 网络异常时走下面的 API 分支
    }
  }

  const data = await ghFetch<{ content?: string; encoding?: string; sha: string; path: string }>(
    settings,
    `${repoPath(settings)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
  )
  cache.shas.set(path, data.sha)
  return {
    path,
    name,
    sha: data.sha,
    title: '',
    date: '',
    loaded: false,
    content: decodeContent(data),
  }
}

/** 文章是否已存在 */
export async function fileExists(settings: Settings, path: string): Promise<string | null> {
  if (cache.shas.has(path)) return cache.shas.get(path) ?? null
  const branch = await resolveDefaultBranch(settings)
  try {
    const data = await ghFetch<{ sha: string }>(
      settings,
      `${repoPath(settings)}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
    )
    cache.shas.set(path, data.sha)
    return data.sha
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

/* ------------------------------------------------------------------ 写入 */

export interface CommitResult {
  path: string
  sha: string
  htmlUrl: string
  created: boolean
}

export interface WriteOptions {
  /** 已知 sha（更新时必填，避免覆盖别人的修改）；null 表示新建 */
  sha?: string | null
  message: string
}

/** 写入一个文本文件；sha 为 null/未提供时若远端已存在则自动补一次查询 */
export async function writeTextFile(
  settings: Settings,
  path: string,
  content: string,
  options: WriteOptions,
): Promise<CommitResult> {
  const branch = await resolveDefaultBranch(settings)
  let sha = options.sha ?? null
  if (!sha) sha = await fileExists(settings, path)

  const body: Record<string, unknown> = {
    message: options.message,
    content: base64EncodeUtf8(content),
    branch,
  }
  if (sha) body.sha = sha

  const res = await ghFetch<{ content: { sha: string; html_url: string } }>(
    settings,
    `${repoPath(settings)}/contents/${encodeURIComponent(path)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
  cache.shas.set(path, res.content.sha)
  if (cache.branch === undefined) cache.branch = branch
  return { path, sha: res.content.sha, htmlUrl: res.content.html_url, created: !sha }
}

/** 写入一个二进制文件（图片） */
export async function writeBinaryFile(
  settings: Settings,
  path: string,
  bytes: ArrayBuffer,
  message: string,
  sha?: string | null,
): Promise<CommitResult> {
  const branch = await resolveDefaultBranch(settings)
  const existing = sha ?? (await fileExists(settings, path))
  const b64 = wrapBase64(
    (() => {
      const view = new Uint8Array(bytes)
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < view.length; i += chunk) {
        binary += String.fromCharCode(...view.subarray(i, i + chunk))
      }
      return btoa(binary)
    })(),
  )
  const body: Record<string, unknown> = { message, content: b64, branch }
  if (existing) body.sha = existing

  const res = await ghFetch<{ content: { sha: string; html_url: string } }>(
    settings,
    `${repoPath(settings)}/contents/${encodeURIComponent(path)}`,
    { method: 'PUT', body: JSON.stringify(body) },
  )
  cache.shas.set(path, res.content.sha)
  return { path, sha: res.content.sha, htmlUrl: res.content.html_url, created: !existing }
}

/* ------------------------------------------------------------------ 辅助 */

export function sanitizeFileName(input: string, fallback: string): string {
  const cleaned = input
    .trim()
    .replace(/\.md$/i, '')
    .replace(/[\\/]+/g, '-')
    .replace(/[\s]+/g, '-')
    .replace(/[<>:"|?*\u0000-\u001f]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const name = cleaned || fallback
  return name.length > 80 ? name.slice(0, 80) : name
}

/** 默认文件名：<prefix><YYYYMMDD>，与仓库现有命名习惯一致 */
export function defaultFileName(prefix: string, date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  return `${prefix}${stamp}`
}

/**
 * 从 slug 反查 / 从文件名构造文章在网上的地址。
 * hugo.toml 里 `posts = "/posts/:slug"`，所以地址由 slug 决定，与文件名无关。
 */
export function postUrl(siteUrl: string, slug: string): string {
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`
  return `${base}posts/${encodeURIComponent(slug)}/`
}

export function blobUrl(settings: Settings, branch: string, path: string): string {
  return `https://github.com/${settings.owner}/${settings.repo}/blob/${branch}/${path}`
}

export function actionsUrl(settings: Settings): string {
  return `https://github.com/${settings.owner}/${settings.repo}/actions`
}
