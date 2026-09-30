import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { MarkdownEditor } from '../components/MarkdownEditor'
import { WriteToolbar } from '../components/WriteToolbar'
import { ChipInput } from '../components/ChipInput'
import { useStore } from '../lib/store-context'
import {
  countWords,
  parsePost,
  serializeFrontMatterBlock,
  serializePost,
} from '../lib/frontmatter'
import {
  defaultFileName,
  postUrl,
  sanitizeFileName,
  writeBinaryFile,
  writeTextFile,
  GitHubError,
} from '../lib/github'
import { deleteDraft, newDraftId, saveDraft } from '../lib/drafts'
import type { Draft } from '../lib/drafts'
import { ensureKatexStyles, renderMarkdown } from '../lib/markdown'
import { prepareImage, formatBytes, timestampName } from '../lib/image'
import {
  createEmptyFrontMatter,
  parseHugoDate,
  randomSlug,
  toDateTimeLocal,
  toHugoDate,
} from '../types'
import type { FrontMatter, PostSummary } from '../types'

interface Props {
  /** 从仓库打开已有文章时传入；新建时为 null */
  initial: PostSummary | null
  /** 恢复的本地草稿 */
  initialDraft: Draft | null
  /** 演示模式：只在本机填写示例内容，不会提交任何东西（用于没配置 Token 时先看看效果） */
  demo?: boolean
  onExit: () => void
  onPublished: (info: { path: string; slug: string; created: boolean }) => void
}

interface PublishInfo {
  path: string
  slug: string
  created: boolean
  htmlUrl: string
}

const DEMO_BODY = `## 二级标题

这是 **粗体**、*斜体* 和 \`行内代码\`，以及一个[外链](https://gohugo.io)。

行内公式 $a_1 = b_2$，块级公式：

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

> 引用一行，用来确认样式。

- 列表一
- [ ] 待办事项
- [x] 已完成事项

| 列 1 | 列 2 |
| --- | --- |
| a | b |

\`\`\`js
const answer = 42
\`\`\`

<!--more-->

以上就是演示内容。点右上角 ⚙ 可以展开高级选项看看 front matter 相关的字段。
`

export function EditorScreen({ initial, initialDraft, demo = false, onExit, onPublished }: Props) {
  const store = useStore()
  const { settings, pushToast, taxonomies } = store

  const [frontMatter, setFrontMatter] = useState<FrontMatter>(() =>
    initialDraft?.frontMatter ?? createEmptyFrontMatter(),
  )
  const [body, setBody] = useState<string>(() => initialDraft?.body ?? '')
  const [fileName, setFileName] = useState<string>(() => {
    if (initialDraft) return initialDraft.path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
    if (initial) return initial.name.replace(/\.md$/i, '')
    return defaultFileName(settings.filePrefix, new Date())
  })
  const [sha, setSha] = useState<string | null>(initial?.sha ?? initialDraft?.sha ?? null)
  const [isExisting, setIsExisting] = useState(Boolean(initial))
  const [loading, setLoading] = useState(Boolean(initial))
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [advanced, setAdvanced] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [draftId] = useState(() => initialDraft?.id ?? newDraftId())
  const [published, setPublished] = useState<PublishInfo | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)

  const viewRef = useRef<EditorView | null>(null)
  const initialRef = useRef({ fm: frontMatter, body })

  /* --------------------------------------------------- 演示模式：填示例内容 */

  useEffect(() => {
    if (!demo) return
    setFrontMatter((fm) => ({
      ...fm,
      title: '演示：排版与公式',
      categories: ['演示'],
      tags: ['演示', 'Markdown'],
      math: true,
    }))
    setBody(DEMO_BODY)
    setMode('preview')
  }, [demo])

  /* ---------------------------------------------------------- 载入已有文章 */

  useEffect(() => {
    if (!initial) return
    let cancelled = false
    void (async () => {
      try {
        const { readFile } = await import('../lib/github')
        const file = await readFile(settings, initial.path)
        if (cancelled) return
        const doc = parsePost(file.content)
        setFrontMatter(doc.frontMatter)
        setBody(doc.body)
        setSha(file.sha)
        initialRef.current = { fm: doc.frontMatter, body: doc.body }
      } catch (err) {
        if (cancelled) return
        pushToast('error', err instanceof Error ? err.message : '读取文章失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.path])

  /* ---------------------------------------------------------- 草稿自动保存 */

  const dirty = useMemo(
    () =>
      JSON.stringify(frontMatter) !== JSON.stringify(initialRef.current.fm) ||
      body !== initialRef.current.body,
    [frontMatter, body],
  )

  useEffect(() => {
    if (demo) return
    if (loading || published) return
    if (!dirty) return
    const timer = window.setTimeout(() => {
      const draft: Draft = {
        id: draftId,
        title: frontMatter.title,
        path: `${settings.postsDir.replace(/\/+$/, '')}/${fileName}.md`,
        sha,
        frontMatter,
        body,
        createdAt: initialDraft?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        existing: isExisting,
      }
      void saveDraft(draft)
        .then(() => setLastSavedAt(Date.now()))
        .catch(() => undefined)
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [
    body,
    demo,
    dirty,
    draftId,
    fileName,
    frontMatter,
    initialDraft?.createdAt,
    isExisting,
    loading,
    published,
    settings.postsDir,
    sha,
  ])

  /* ------------------------------------------------------------------ 预览 */

  useEffect(() => {
    if (mode === 'preview' && frontMatter.math) ensureKatexStyles()
  }, [mode, frontMatter.math])

  const previewHtml = useMemo(
    () => (mode === 'preview' ? renderMarkdown(body, frontMatter.math).html : ''),
    [mode, body, frontMatter.math],
  )

  /* -------------------------------------------------------------- 图片上传 */

  const handlePickImage = useCallback(
    async (file: File) => {
      if (!settings.token) {
        pushToast('error', '请先在「设置」里填写 GitHub Token')
        return
      }
      setUploading(true)
      try {
        const prepared = await prepareImage(file, `${timestampName()}`)
        const dir = settings.imagesDir.replace(/^\/+|\/+$/g, '')
        const path = `${dir}/${prepared.baseName}.${prepared.extension}`
        await writeBinaryFile(settings, path, prepared.bytes, `upload image ${prepared.baseName}`)
        const siteBase = settings.siteUrl.endsWith('/') ? settings.siteUrl : `${settings.siteUrl}/`
        const url = `${siteBase}${path.replace(/^static\//, '')}`
        const markdown = `![${prepared.baseName}](${url})`
        const view = viewRef.current
        if (view) {
          const { insertAtCursor } = await import('../lib/editor-actions')
          insertAtCursor(view, markdown)
        } else {
          setBody((prev) => `${prev}\n\n${markdown}\n`)
        }
        pushToast(
          'success',
          prepared.size
            ? `图片已上传（${formatBytes(prepared.size)}），链接已插入正文`
            : '图片已上传，链接已插入正文',
        )
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : '图片上传失败')
      } finally {
        setUploading(false)
      }
    },
    [pushToast, settings],
  )

  /* ------------------------------------------------------------------ 发布 */

  const targetPath = `${settings.postsDir.replace(/\/+$/, '')}/${sanitizeFileName(
    fileName,
    defaultFileName(settings.filePrefix, new Date()),
  )}.md`

  const publish = useCallback(async () => {
    if (!settings.token) {
      pushToast('error', '请先在「设置」里填写 GitHub Token')
      return
    }
    const title = frontMatter.title.trim() || firstLineTitle(body)
    if (!title) {
      pushToast('error', '请先填写标题')
      return
    }
    if (!body.trim()) {
      pushToast('error', '正文还是空的')
      return
    }
    if (frontMatter.categories.length === 0 && frontMatter.tags.length === 0) {
      pushToast('info', '提示：还没有选择分类或标签')
    }

    setPublishing(true)
    try {
      const fm: FrontMatter = { ...frontMatter, title, slug: frontMatter.slug || randomSlug() }
      const text = serializePost({ frontMatter: fm, body })
      const result = await writeTextFile(settings, targetPath, text, {
        sha: isExisting ? sha : null,
        message: isExisting ? `update post: ${title}` : `add post: ${title}`,
      })
      setSha(result.sha)
      setIsExisting(true)
      setFrontMatter(fm)
      initialRef.current = { fm, body }
      await deleteDraft(draftId)
      setPublished({ path: result.path, slug: fm.slug, created: result.created, htmlUrl: result.htmlUrl })
      onPublished({ path: result.path, slug: fm.slug, created: result.created })
      pushToast('success', result.created ? '已提交到 GitHub，正在构建' : '已更新并提交到 GitHub')
    } catch (err) {
      if (err instanceof GitHubError) pushToast('error', err.message)
      else pushToast('error', err instanceof Error ? err.message : '发布失败')
    } finally {
      setPublishing(false)
    }
  }, [
    body,
    draftId,
    fileName,
    frontMatter,
    isExisting,
    onPublished,
    pushToast,
    settings,
    sha,
    targetPath,
  ])

  const insertFrontMatter = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const block = serializeFrontMatterBlock(frontMatter)
    const current = view.state.doc.toString()
    const doc = parsePost(current)
    const next = `${block}${doc.body.replace(/^\n+/, '')}`
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } })
    setBody(next)
    pushToast('info', '已把 front matter 写入正文顶部，可整体复制到 VSCode')
  }, [frontMatter, pushToast])

  const wordCount = useMemo(() => countWords(body), [body])

  const exit = useCallback(() => {
    if (published) {
      onExit()
      return
    }
    if (dirty && !window.confirm('草稿已自动保存在本机。确定要离开编辑页吗？')) return
    onExit()
  }, [dirty, onExit, published])

  /* ------------------------------------------------------------- 发布成功页 */

  if (published) {
    const url = postUrl(settings.siteUrl, published.slug)
    return (
      <div className="screen publish-done">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={onExit}>
            ←
          </button>
          <h1>已发布</h1>
        </header>
        <div className="done-body">
          <div className="done-check">✓</div>
          <h2>{frontMatter.title}</h2>
          <p className="muted">
            提交已推送到 <code>{targetPath}</code>
            {published.created ? '（新建）' : '（更新）'}
          </p>
          <p className="muted">
            GitHub Actions 需要大约 1–3 分钟重新构建，之后文章会出现在博客上。
          </p>
          <div className="done-actions">
            <a className="btn primary" href={url} target="_blank" rel="noreferrer">
              打开文章页面
            </a>
            <a
              className="btn"
              href={`https://github.com/${settings.owner}/${settings.repo}/actions`}
              target="_blank"
              rel="noreferrer"
            >
              查看构建状态
            </a>
            <button type="button" className="btn" onClick={onExit}>
              返回文章列表
            </button>
          </div>
          <p className="muted small">
            文章地址由 front matter 的 slug 决定：<code>{frontMatter.slug}</code>
          </p>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------------ 编辑器 */

  return (
    <div className="screen editor-screen">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={exit} aria-label="返回">
          ←
        </button>
        <h1>{demo ? '演示' : isExisting ? '编辑文章' : '写新文章'}</h1>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAdvanced((v) => !v)}
          aria-label="高级选项"
          title="高级选项"
        >
          ⚙
        </button>
      </header>

      {demo && (
        <div className="demo-bar">
          这是演示内容，不会提交到 GitHub。点左上角 ← 返回，或到「设置」填好 Token 开始真的写。
        </div>
      )}

      {loading ? (
        <div className="loading">正在从 GitHub 读取文章…</div>
      ) : (
        <>
          <div className="meta">
            <input
              className="title-input"
              value={frontMatter.title}
              placeholder="标题"
              onChange={(e) => setFrontMatter((fm) => ({ ...fm, title: e.target.value }))}
              enterKeyHint="next"
            />

            <ChipInput
              label="分类"
              values={frontMatter.categories}
              suggestions={taxonomies.categories}
              onChange={(categories) => setFrontMatter((fm) => ({ ...fm, categories }))}
              placeholder="如：日记 / 诗歌 / 数学"
              hint={
                taxonomies.categories.length
                  ? `${taxonomies.categories.length} 个已有分类，可点选`
                  : undefined
              }
            />
            <ChipInput
              label="标签"
              values={frontMatter.tags}
              suggestions={taxonomies.tags}
              onChange={(tags) => setFrontMatter((fm) => ({ ...fm, tags }))}
              placeholder="如：日记、随笔"
              hint={
                taxonomies.tags.length ? `${taxonomies.tags.length} 个已有标签，可点选` : undefined
              }
            />

            <div className="meta-row">
              <button
                type="button"
                className={`switch ${frontMatter.math ? 'on' : ''}`}
                onClick={() => setFrontMatter((fm) => ({ ...fm, math: !fm.math }))}
                aria-pressed={frontMatter.math}
              >
                <span className="switch-dot" />
                数学公式
              </button>
              <button
                type="button"
                className={`switch ${frontMatter.toc ? 'on' : ''}`}
                onClick={() => setFrontMatter((fm) => ({ ...fm, toc: !fm.toc }))}
                aria-pressed={frontMatter.toc}
              >
                <span className="switch-dot" />
                目录
              </button>
              <button
                type="button"
                className={`switch ${frontMatter.draft ? 'on' : ''}`}
                onClick={() => setFrontMatter((fm) => ({ ...fm, draft: !fm.draft }))}
                aria-pressed={frontMatter.draft}
                title="标记为草稿后不会出现在博客上"
              >
                <span className="switch-dot" />
                草稿
              </button>
            </div>

            {advanced && (
              <div className="advanced">
                <div className="field">
                  <label htmlFor="post-date">时间</label>
                  <input
                    id="post-date"
                    className="text-input"
                    type="datetime-local"
                    value={
                      parseHugoDate(frontMatter.date)
                        ? toDateTimeLocal(parseHugoDate(frontMatter.date)!)
                        : toDateTimeLocal(new Date())
                    }
                    onChange={(e) => {
                      const d = new Date(e.target.value)
                      if (!Number.isNaN(d.getTime()))
                        setFrontMatter((fm) => ({ ...fm, date: toHugoDate(d) }))
                    }}
                  />
                </div>

                <div className="field">
                  <div className="field-head">
                    <label htmlFor="post-file">文件名</label>
                    <span className="field-hint">content/posts/ 下</span>
                  </div>
                  <div className="row">
                    <input
                      id="post-file"
                      className="text-input"
                      value={fileName}
                      onChange={(e) => setFileName(e.target.value)}
                      placeholder={defaultFileName(settings.filePrefix, new Date())}
                    />
                    <span className="suffix">.md</span>
                  </div>
                </div>

                <div className="field">
                  <div className="field-head">
                    <label htmlFor="post-slug">slug（决定文章网址）</label>
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => setFrontMatter((fm) => ({ ...fm, slug: randomSlug() }))}
                    >
                      重新生成
                    </button>
                  </div>
                  <input
                    id="post-slug"
                    className="text-input"
                    value={frontMatter.slug}
                    onChange={(e) =>
                      setFrontMatter((fm) => ({
                        ...fm,
                        slug: e.target.value.replace(/\s+/g, '-').toLowerCase(),
                      }))
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="post-summary">摘要</label>
                  <input
                    id="post-summary"
                    className="text-input"
                    value={frontMatter.summary}
                    onChange={(e) => setFrontMatter((fm) => ({ ...fm, summary: e.target.value }))}
                    placeholder="留空则用正文开头"
                  />
                </div>

                <div className="field">
                  <button type="button" className="btn ghost full" onClick={insertFrontMatter}>
                    把 front matter 写入正文顶部
                  </button>
                  <p className="field-hint">
                    想在 VSCode 里继续编辑时用：写入后可整段复制，粘贴到本地文件即可。
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="editor-area">
            <div className="segmented">
              <button
                type="button"
                className={mode === 'write' ? 'active' : ''}
                onClick={() => setMode('write')}
              >
                编辑
              </button>
              <button
                type="button"
                className={mode === 'preview' ? 'active' : ''}
                onClick={() => setMode('preview')}
              >
                预览
              </button>
              <span className="editor-stats">
                {wordCount} 字 · {body.split('\n').length} 行
                {lastSavedAt ? ' · 已存本地' : ''}
              </span>
            </div>

            {mode === 'write' ? (
              <>
                <WriteToolbar
                  getView={() => viewRef.current}
                  onPickImage={(file) => void handlePickImage(file)}
                  mathEnabled={frontMatter.math}
                  busyImage={uploading}
                />
                <MarkdownEditor
                  value={body}
                  onChange={setBody}
                  onReady={(view) => {
                    viewRef.current = view
                  }}
                  placeholder={'在这里写正文，支持 Markdown。\n\n<!--more--> 之前的内容会作为摘要。'}
                />
              </>
            ) : (
              <div
                className="preview markdown-body"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            )}
          </div>

          <div className="editor-footer">
            <span className="muted small">
              {demo ? '演示模式：不会提交到仓库' : `目标：${targetPath}`}
              {!demo && !store.online && ' · 离线中，草稿会先存在本机'}
            </span>
            <button
              type="button"
              className="btn primary"
              disabled={publishing}
              onClick={() => (demo ? onExit() : void publish())}
            >
              {demo ? '返回' : publishing ? '提交中…' : isExisting ? '更新并发布' : '发布到博客'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function firstLineTitle(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find((l) => l.length > 0)
  return line ? line.slice(0, 60) : ''
}
