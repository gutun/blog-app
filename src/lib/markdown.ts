/**
 * Markdown → HTML 渲染，力求与线上 Hugo(Goldmark + KaTeX) 的效果一致。
 *
 * 数学公式的处理方式与 hugo.toml 里的 `passthrough` 扩展等价：
 * 先把 $...$ / $$...$$ / \(...\) / \[...\] 抠出来换成占位符，
 * 这样公式里的 `_`、`*`、`\\` 就不会被 Markdown 当成强调语法破坏掉。
 */
import MarkdownIt from 'markdown-it'
import katex from 'katex'

/**
 * markdown-it 14 内部支持 `tasklist` 选项（GFM 任务列表），
 * 但 @types/markdown-it 还没有补上这个字段，这里补一个类型声明。
 */
declare module 'markdown-it' {
  interface Options {
    tasklist?: boolean
  }
}

/**
 * 占位符不能用 \u0000：markdown-it 的 core 规则会把控制字符替换成 U+FFFD，
 * 结果就是公式永远还原不回来（曾经踩过这个坑，测试里专门覆盖了）。
 * 这里用一段普通文本，正常文章里不会出现。
 */
const PLACEHOLDER_PREFIX = '@@DSHMATH'
const PLACEHOLDER_SUFFIX = '@@'
const PLACEHOLDER_RE = /@@DSHMATH(\d+)@@/g

const MATH_PATTERN = new RegExp(
  [
    '\\$\\$(?<display1>[\\s\\S]+?)\\$\\$',
    '\\\\\\[(?<display2>[\\s\\S]+?)\\\\\\]',
    '\\\\\\((?<inline1>[\\s\\S]+?)\\\\\\)',
    '\\$(?<inline2>[^$\\n]+?)\\$',
  ].join('|'),
  'g',
)

interface MathToken {
  tex: string
  displayMode: boolean
}

function extractMath(src: string): { text: string; tokens: MathToken[] } {
  const tokens: MathToken[] = []
  const text = src.replace(
    MATH_PATTERN,
    (
      match,
      display1?: string,
      display2?: string,
      inline1?: string,
      inline2?: string,
    ) => {
      const groups = { display1, display2, inline1, inline2 }
      const key = (Object.keys(groups) as (keyof typeof groups)[]).find(
        (k) => groups[k] !== undefined,
      )
      if (!key) return match
      const tex = (groups[key] as string).trim()
      if (!tex) return match
      // 一个很常见的误配：`$a$ 与 $b$` 中的 `$ 与 $`（内容只有空白）。
      // 这种不算公式，原样留给 Markdown 处理，否则会把 “ 与 ” 当成数学公式渲染。
      if (!/\S/.test(tex)) return match
      const displayMode = key === 'display1' || key === 'display2'
      const index = tokens.push({ tex, displayMode }) - 1
      return `${PLACEHOLDER_PREFIX}${index}${PLACEHOLDER_SUFFIX}`
    },
  )
  return { text, tokens }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
  // 任务列表：- [ ] / - [x]（与 hugo.toml 中 goldmark 的 taskList = true 对应）
  tasklist: true,
})

// 外链在新标签打开，并补上 rel，避免 window.opener 泄漏
const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? ''
  if (/^https?:\/\//i.test(href)) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// 图片：懒加载 + 可点击放大（与主题 lightgallery 行为接近）
md.renderer.rules.image = (tokens, idx, options, _env, self) => {
  tokens[idx].attrSet('loading', 'lazy')
  tokens[idx].attrSet('decoding', 'async')
  return self.renderToken(tokens, idx, options)
}

/**
 * GFM 任务列表：把正文开头的 "[ ] " / "[x] " 变成真实复选框，
 * 与 hugo.toml 里 goldmark 的 taskList = true 表现一致。
 */
md.core.ruler.after('inline', 'gfm-task-list', (state) => {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== 'inline') continue
    if (tokens[i - 1].type !== 'paragraph_open') continue
    if (tokens[i - 2].type !== 'list_item_open') continue
    const token = tokens[i]
    const match = /^\[([ xX])\]\s+/.exec(token.content)
    if (!match) continue
    const checkbox = new state.Token('html_inline', '', 0)
    checkbox.content = `<input type="checkbox" disabled${match[1] === ' ' ? '' : ' checked'}> `
    token.content = token.content.slice(match[0].length)
    if (token.children && token.children[0]?.type === 'text') {
      token.children[0].content = token.children[0].content.replace(/^\[([ xX])\]\s+/, '')
    }
    token.children = [checkbox, ...(token.children ?? [])]
  }
  return true
})

export interface RenderedHtml {
  html: string
}

/** 渲染正文；`math` 为 false 时不处理公式（与文章 front matter 的 math 字段一致） */
export function renderMarkdown(source: string, math: boolean): RenderedHtml {
  if (!math) return { html: md.render(source) }

  const { text, tokens } = extractMath(source)
  let html = md.render(text)

  html = html.replace(PLACEHOLDER_RE, (_m, rawIndex: string) => {
    const token = tokens[Number(rawIndex)]
    if (!token) return ''
    try {
      const rendered = katex.renderToString(token.tex, {
        displayMode: token.displayMode,
        throwOnError: false,
        strict: false,
        trust: false,
        output: 'html',
      })
      return token.displayMode
        ? `<div class="math-block">${rendered}</div>`
        : `<span class="math-inline">${rendered}</span>`
    } catch (err) {
      // 公式写错时给出可见提示，但不影响其它内容
      const message = err instanceof Error ? err.message : String(err)
      return `<code class="math-error" title="${escapeHtml(message)}">${escapeHtml(
        token.tex,
      )}</code>`
    }
  })

  // 段落里若只剩一个块级公式，去掉多余的空 <p>
  html = html.replace(/<p>\s*(<div class="math-block">[\s\S]*?<\/div>)\s*<\/p>/g, '$1')

  return { html }
}

/**
 * KaTeX 的字体文件（katex.min.css 已在 main.tsx 里全局引入）。
 * 首次需要渲染公式时再挂上，避免每次启动都多一次网络请求；
 * 离线时由 Service Worker 缓存兜底。
 */
export const KATEX_STYLESHEET =
  'https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css'

let katexCssLoaded = false
export function ensureKatexStyles(): void {
  if (katexCssLoaded) return
  katexCssLoaded = true
  const fonts = document.createElement('link')
  fonts.rel = 'stylesheet'
  fonts.href = KATEX_STYLESHEET
  fonts.crossOrigin = 'anonymous'
  document.head.appendChild(fonts)
}
