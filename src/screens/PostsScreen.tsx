import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store-context'
import { GitHubError, listPostFiles, readFile } from '../lib/github'
import { parsePost } from '../lib/frontmatter'
import { deleteDraft, draftSummary, listDrafts } from '../lib/drafts'
import type { Draft } from '../lib/drafts'
import type { PostSummary } from '../types'

interface Props {
  onOpen: (post: PostSummary) => void
  onOpenDraft: (draft: Draft) => void
  onCompose: () => void
  onDemo: () => void
  onSettings: () => void
}

interface PostMeta {
  title: string
  date: string
  categories: string[]
  tags: string[]
}

const PAGE_SIZE = 20
const CONCURRENCY = 6

function formatDate(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  return `${Math.floor(hour / 24)} 天前`
}

/** 文件名里带 YYYYMMDD 时可以先按它排序，避免等 front matter 解析完 */
function fallbackKey(name: string): string {
  const match = /(\d{8})/.exec(name)
  return match ? match[1] : name
}

export function PostsScreen({ onOpen, onOpenDraft, onCompose, onDemo, onSettings }: Props) {
  const store = useStore()
  const { settings } = store

  const [posts, setPosts] = useState<PostSummary[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [metaVersion, setMetaVersion] = useState(0)

  const metaRef = useRef(new Map<string, PostMeta>())
  const generationRef = useRef(0)

  const configured = Boolean(settings.token && settings.owner && settings.repo)

  const refreshDrafts = useCallback(async () => {
    try {
      setDrafts(await listDrafts())
    } catch {
      setDrafts([])
    }
  }, [])

  /** 分批读取正文，只解析 front matter 用来渲染列表 */
  const loadMetadata = useCallback(
    async (list: PostSummary[], generation: number) => {
      const missing = list.map((p) => p.path).filter((path) => !metaRef.current.has(path))
      setProgress({ done: 0, total: missing.length })
      if (missing.length === 0) return
      let done = 0
      let cursor = 0

      const worker = async () => {
        while (cursor < missing.length) {
          const path = missing[cursor++]
          try {
            const file = await readFile(settings, path)
            if (generation !== generationRef.current) return
            const doc = parsePost(file.content)
            metaRef.current.set(path, {
              title: doc.frontMatter.title,
              date: doc.frontMatter.date,
              categories: doc.frontMatter.categories,
              tags: doc.frontMatter.tags,
            })
          } catch {
            metaRef.current.set(path, { title: '', date: '', categories: [], tags: [] })
          }
          done += 1
          if (generation === generationRef.current && done % 4 === 0) {
            setProgress({ done, total: missing.length })
            setMetaVersion((n) => n + 1)
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, missing.length) }, () => worker()),
      )
      if (generation === generationRef.current) {
        setProgress({ done: missing.length, total: missing.length })
        setMetaVersion((n) => n + 1)
      }
    },
    [settings],
  )

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current
    setError(null)
    await refreshDrafts()
    if (!configured) {
      setPosts([])
      return
    }
    setLoading(true)
    try {
      const list = await listPostFiles(settings)
      if (generation !== generationRef.current) return
      setPosts(list)
      setPage(1)
      void loadMetadata(list, generation)
    } catch (err) {
      if (generation !== generationRef.current) return
      setError(
        err instanceof GitHubError
          ? err.message
          : err instanceof Error
            ? err.message
            : '读取文章列表失败',
      )
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [configured, loadMetadata, refreshDrafts, settings])

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.token, settings.owner, settings.repo, settings.postsDir])

  const sorted = useMemo(() => {
    void metaVersion
    const withDate = posts.map((p) => ({ post: p, meta: metaRef.current.get(p.path) }))
    withDate.sort((a, b) => {
      const da = a.meta?.date ?? ''
      const db = b.meta?.date ?? ''
      if (da && db) return db.localeCompare(da)
      if (da) return -1
      if (db) return 1
      return fallbackKey(b.post.name).localeCompare(fallbackKey(a.post.name))
    })
    return withDate
  }, [posts, metaVersion])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(({ post, meta: m }) =>
      [post.name, m?.title ?? '', ...(m?.categories ?? []), ...(m?.tags ?? [])]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [sorted, query])

  const visible = filtered.slice(0, page * PAGE_SIZE)
  const busy = loading || progress.done < progress.total
  const categoryCount = useMemo(
    () => new Set(sorted.flatMap(({ meta: m }) => m?.categories ?? [])).size,
    [sorted],
  )

  return (
    <div className="screen list-screen">
      <header className="topbar">
        <h1>我的博客</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={() => void refresh()}
            aria-label="刷新"
            title="刷新"
          >
            ⟳
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={onSettings}
            aria-label="设置"
            title="设置"
          >
            ⚙
          </button>
        </div>
      </header>

      {!configured && (
        <div className="notice">
          <p>还没有配置 GitHub 访问令牌，暂时无法读取或发布文章。</p>
          <div className="notice-actions">
            <button type="button" className="btn primary" onClick={onSettings}>
              去设置
            </button>
            <button type="button" className="btn ghost" onClick={onDemo}>
              先看看演示
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="notice error">
          <p>{error}</p>
          <button type="button" className="btn" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      )}

      {drafts.length > 0 && (
        <section className="list-section">
          <h2 className="section-title">
            本机草稿 <span className="badge">{drafts.length}</span>
          </h2>
          {drafts.map((draft) => (
            <div className="post-row draft" key={draft.id}>
              <button type="button" className="post-main" onClick={() => onOpenDraft(draft)}>
                <span className="post-title">
                  {draft.title || draft.body.split('\n')[0]?.trim() || '（无标题）'}
                </span>
                <span className="post-sub">
                  {draft.existing ? '已发布文章的修改' : '未发布'} ·{' '}
                  {relativeTime(draft.updatedAt)}
                </span>
                <span className="post-excerpt">{draftSummary(draft) || '（空白草稿）'}</span>
              </button>
              <button
                type="button"
                className="icon-btn danger"
                aria-label="删除草稿"
                onClick={() => {
                  if (!window.confirm('删除这条本机草稿？')) return
                  void deleteDraft(draft.id).then(refreshDrafts)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="list-section">
        <div className="list-head">
          <h2 className="section-title">
            已发布 <span className="badge">{configured ? filtered.length : 0}</span>
          </h2>
          {busy && configured && (
            <span className="muted small">
              {loading ? '读取中…' : `解析 ${progress.done}/${progress.total}`}
            </span>
          )}
        </div>

        {configured && posts.length > 0 && (
          <input
            className="text-input search"
            value={query}
            placeholder="搜索标题 / 文件名 / 分类 / 标签"
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            type="search"
          />
        )}

        {configured && !loading && filtered.length === 0 && !error && (
          <p className="muted center">
            {posts.length === 0 ? '仓库里还没有文章' : '没有匹配的文章'}
          </p>
        )}

        {visible.map(({ post, meta: m }) => {
          const title = m?.title || post.name.replace(/\.md$/i, '')
          const labels = [...(m?.categories ?? []), ...(m?.tags ?? [])].slice(0, 4)
          return (
            <button
              type="button"
              className="post-row"
              key={post.path}
              onClick={() => onOpen(post)}
            >
              <span className="post-title">{title}</span>
              <span className="post-sub">
                {m?.date ? <span className="post-date">{formatDate(m.date)}</span> : null}
                <code className="post-file">{post.name}</code>
              </span>
              {labels.length > 0 && (
                <span className="post-labels">
                  {labels.map((l) => (
                    <span className="mini-chip" key={l}>
                      {l}
                    </span>
                  ))}
                </span>
              )}
            </button>
          )
        })}

        {visible.length < filtered.length && (
          <button type="button" className="btn full" onClick={() => setPage((p) => p + 1)}>
            加载更多（还有 {filtered.length - visible.length} 篇）
          </button>
        )}
      </section>

      <p className="footer-note">
        {configured ? `${posts.length} 篇文章 · ${categoryCount} 个分类` : '未配置仓库'}
        {' · '}
        <a href={settings.siteUrl} target="_blank" rel="noreferrer">
          打开博客
        </a>
      </p>

      <button type="button" className="fab" onClick={onCompose} aria-label="写新文章">
        ＋
      </button>
    </div>
  )
}
