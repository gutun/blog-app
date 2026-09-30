/**
 * Hugo front matter 的解析与生成。
 *
 * 目标：APP 生成的文件与 `hugo new posts/xxx.md`（archetypes/posts.md）几乎逐字一致，
 * 并且解析已有文章时「未知字段原样保留」，不会因为用 App 改一次标题而丢字段。
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { createEmptyFrontMatter, randomSlug } from '../types.ts'
import type { FrontMatter, PostDoc } from '../types.ts'

const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return fallback
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(v)) return true
    if (['false', 'no', 'off', '0', ''].includes(v)) return false
  }
  if (typeof value === 'number') return value !== 0
  return fallback
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const n = Number(asString(value, ''))
  return Number.isFinite(n) && asString(value, '') !== '' ? n : fallback
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => asString(v)).filter((v) => v !== '')
  }
  const single = asString(value)
  return single ? [single] : []
}

/** formatter 可能是 Date 或 ISO 字符串；统一成 Hugo 的本地偏移格式 */
function normalizeDate(value: unknown): string {
  if (value instanceof Date) {
    const d = value
    const pad = (n: number) => String(n).padStart(2, '0')
    const off = -d.getTimezoneOffset()
    const sign = off >= 0 ? '+' : '-'
    const abs = Math.abs(off)
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
    )
  }
  const raw = asString(value).trim()
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return normalizeDate(parsed)
}

/** 拆出 front matter 与正文；没有 front matter 时视为纯正文 */
export function parsePost(raw: string): PostDoc {
  const match = FM_RE.exec(raw)
  const base = createEmptyFrontMatter()

  if (!match) {
    return { frontMatter: base, body: raw.replace(/^\uFEFF/, '') }
  }

  let data: Record<string, unknown> = {}
  try {
    const parsed = parseYaml(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>
    }
  } catch {
    // front matter 语法有误（手机上手工改坏了）：退化为空 front matter，正文仍然可编辑
    data = {}
  }

  const authorRaw = (data.author ?? {}) as Record<string, unknown>
  const repostRaw = (data.repost ?? {}) as Record<string, unknown>

  const known = new Set([
    'title',
    'subtitle',
    'date',
    'slug',
    'draft',
    'author',
    'description',
    'keywords',
    'license',
    'comment',
    'weight',
    'tags',
    'categories',
    'hiddenFromHomePage',
    'hiddenFromSearch',
    'hiddenFromRelated',
    'hiddenFromFeed',
    'summary',
    'toc',
    'math',
    'lightgallery',
    'password',
    'message',
    'repost',
  ])
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (!known.has(key)) extra[key] = value
  }

  const frontMatter: FrontMatter = {
    title: asString(data.title),
    subtitle: asString(data.subtitle),
    date: normalizeDate(data.date),
    slug: asString(data.slug) || randomSlug(),
    draft: asBool(data.draft, false),
    author: {
      name: asString(authorRaw.name, 'GUTUN'),
      link: asString(authorRaw.link),
      email: asString(authorRaw.email),
      avatar: asString(authorRaw.avatar),
    },
    description: asString(data.description),
    keywords: asStringArray(data.keywords),
    license: asString(data.license),
    comment: asBool(data.comment, false),
    weight: asNumber(data.weight, 0),
    tags: asStringArray(data.tags),
    categories: asStringArray(data.categories),
    hiddenFromHomePage: asBool(data.hiddenFromHomePage, false),
    hiddenFromSearch: asBool(data.hiddenFromSearch, false),
    hiddenFromRelated: asBool(data.hiddenFromRelated, false),
    hiddenFromFeed: asBool(data.hiddenFromFeed, false),
    summary: asString(data.summary),
    toc: asBool(data.toc, true),
    math: asBool(data.math, false),
    lightgallery: asBool(data.lightgallery, false),
    password: asString(data.password),
    message: asString(data.message),
    repost: { enable: asBool(repostRaw.enable, true), url: asString(repostRaw.url) },
    extra,
  }

  return { frontMatter, body: raw.slice(match[0].length) }
}

/** 标量输出：交给 yaml 库处理引号/转义，保证标题里的冒号、引号不会破坏文件 */
function scalar(value: string): string {
  return stringifyYaml(value, { defaultStringType: 'PLAIN', defaultKeyType: 'PLAIN' }).trimEnd()
}

function blockKey(key: string, values: string[]): string {
  if (values.length === 0) return `${key}:\n`
  const lines = values.map((v) => `  - ${scalar(v)}`)
  return `${key}:\n${lines.join('\n')}\n`
}

function extraToYaml(extra: Record<string, unknown>): string {
  const keys = Object.keys(extra)
  if (keys.length === 0) return ''
  const text = stringifyYaml(extra, { lineWidth: 0 }).trimEnd()
  return text ? `\n${text}\n` : ''
}

/**
 * 生成完整 Markdown 文件（front matter + 正文）。
 * 字段顺序、注释、`<!--more-->` 都与 archetypes/posts.md 对齐。
 */
export function serializePost(doc: PostDoc): string {
  const fm = doc.frontMatter
  const lines: string[] = []
  lines.push('---')
  lines.push(`title: ${scalar(fm.title)}`)
  lines.push(`subtitle: ${fm.subtitle ? scalar(fm.subtitle) : ''}`)
  lines.push(`date: ${fm.date}`)
  lines.push(`slug: ${fm.slug}`)
  lines.push(`draft: ${fm.draft}`)
  lines.push('author:')
  lines.push(`  name: ${fm.author.name ? scalar(fm.author.name) : ''}`)
  lines.push(`  link: ${fm.author.link ? scalar(fm.author.link) : ''}`)
  lines.push(`  email: ${fm.author.email ? scalar(fm.author.email) : ''}`)
  lines.push(`  avatar: ${fm.author.avatar ? scalar(fm.author.avatar) : ''}`)
  lines.push(`description: ${fm.description ? scalar(fm.description) : ''}`)
  lines.push(
    fm.keywords.length ? blockKey('keywords', fm.keywords).trimEnd() : 'keywords:',
  )
  lines.push(`license: ${fm.license ? scalar(fm.license) : ''}`)
  lines.push(`comment: ${fm.comment}`)
  lines.push(`weight: ${fm.weight}`)
  lines.push(blockKey('tags', fm.tags).trimEnd())
  lines.push(blockKey('categories', fm.categories).trimEnd())
  lines.push(`hiddenFromHomePage: ${fm.hiddenFromHomePage}`)
  lines.push(`hiddenFromSearch: ${fm.hiddenFromSearch}`)
  lines.push(`hiddenFromRelated: ${fm.hiddenFromRelated}`)
  lines.push(`hiddenFromFeed: ${fm.hiddenFromFeed}`)
  lines.push(`summary: ${fm.summary ? scalar(fm.summary) : ''}`)
  lines.push(`toc: ${fm.toc}`)
  lines.push(`math: ${fm.math}`)
  lines.push(`lightgallery: ${fm.lightgallery}`)
  lines.push(`password: ${fm.password ? scalar(fm.password) : ''}`)
  lines.push(`message: ${fm.message ? scalar(fm.message) : ''}`)
  lines.push('repost:')
  lines.push(`  enable: ${fm.repost.enable}`)
  lines.push(`  url: ${fm.repost.url ? scalar(fm.repost.url) : ''}`)

  const extra = extraToYaml(fm.extra)
  if (extra) lines.push(extra.trimEnd())

  lines.push('')
  lines.push(
    '# See details front matter: https://fixit.lruihao.cn/documentation/content-management/introduction/#front-matter',
  )
  lines.push('---')
  lines.push('')

  const body = doc.body.replace(/^\s*\n/, '')
  return `${lines.join('\n')}${body}`
}

/** front matter + 正文重新拼成可编辑文本（编辑已有文章时用） */
export function serializeFrontMatterBlock(fm: FrontMatter): string {
  return serializePost({ frontMatter: fm, body: '' }).replace(/\n+$/, '\n')
}

export function countWords(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z0-9]+/g) ?? []).length
  return cjk + latin
}
