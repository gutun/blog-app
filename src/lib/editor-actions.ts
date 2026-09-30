/**
 * 工具栏插入的 Markdown 片段。
 * 全部基于 CodeMirror 的 dispatch，因此原生支持「撤销」，
 * 并且会保持光标/选区位置，手机上不会跳到文首。
 */
import type { EditorView } from '@codemirror/view'

function selectedText(view: EditorView): string {
  const { from, to } = view.state.selection.main
  return view.state.sliceDoc(from, to)
}

/** 用前后缀包裹选区；无选区时插入占位词并选中它，方便直接替换 */
function wrapSelection(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
): void {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to) || placeholder
  const insert = `${before}${text}${after}`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + before.length, head: from + before.length + text.length },
    scrollIntoView: true,
  })
  view.focus()
}

/** 在行首加前缀（引用、列表等） */
function prefixLines(view: EditorView, prefix: string): void {
  const { from, to } = view.state.selection.main
  const startLine = view.state.doc.lineAt(from)
  const endLine = view.state.doc.lineAt(to)
  const changes: { from: number; to: number; insert: string }[] = []
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = view.state.doc.line(n)
    changes.push({ from: line.from, to: line.from, insert: prefix })
  }
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

/** 插入纯文本到光标处（图片、公式模板等） */
export function insertAtCursor(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
  })
  view.focus()
}

export const markdownActions = {
  bold: (v: EditorView) => wrapSelection(v, '**', '**', '粗体'),
  italic: (v: EditorView) => wrapSelection(v, '*', '*', '斜体'),
  strikethrough: (v: EditorView) => wrapSelection(v, '~~', '~~', '删除线'),
  inlineCode: (v: EditorView) => wrapSelection(v, '`', '`', '代码'),
  codeBlock: (v: EditorView) => {
    const text = selectedText(v) || '代码'
    const { from, to } = v.state.selection.main
    const needLeading = from > 0 && v.state.sliceDoc(from - 1, from) !== '\n'
    const block = `${needLeading ? '\n' : ''}\`\`\`\n${text}\n\`\`\`\n`
    v.dispatch({
      changes: { from, to, insert: block },
      selection: { anchor: from + block.length - 4, head: from + block.length - 4 },
      scrollIntoView: true,
    })
    v.focus()
  },
  heading: (v: EditorView) => prefixLines(v, '## '),
  quote: (v: EditorView) => prefixLines(v, '> '),
  bulletList: (v: EditorView) => prefixLines(v, '- '),
  orderedList: (v: EditorView) => prefixLines(v, '1. '),
  taskList: (v: EditorView) => prefixLines(v, '- [ ] '),
  link: (v: EditorView) => wrapSelection(v, '[', '](https://)', '链接文字'),
  mathInline: (v: EditorView) => wrapSelection(v, '$', '$', 'x^2'),
  mathBlock: (v: EditorView) => {
    const text = selectedText(v) || 'E = mc^2'
    const { from, to } = v.state.selection.main
    const needLeading = from > 0 && v.state.sliceDoc(from - 1, from) !== '\n'
    const block = `${needLeading ? '\n' : ''}$$\n${text}\n$$\n`
    v.dispatch({
      changes: { from, to, insert: block },
      selection: { anchor: from + block.length },
      scrollIntoView: true,
    })
    v.focus()
  },
  more: (v: EditorView) => insertAtCursor(v, '\n<!--more-->\n\n'),
  table: (v: EditorView) =>
    insertAtCursor(
      v,
      '\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n',
    ),
  hr: (v: EditorView) => insertAtCursor(v, '\n---\n\n'),
}

export type MarkdownActionName = keyof typeof markdownActions

export interface ToolbarItem {
  name: MarkdownActionName
  /** Font Awesome 风格图标（用内联 SVG 之外的字符代替，避免额外依赖） */
  label: string
  title: string
}

export const TOOLBAR_ITEMS: ToolbarItem[] = [
  { name: 'heading', label: 'H2', title: '二级标题' },
  { name: 'bold', label: 'B', title: '粗体' },
  { name: 'italic', label: 'I', title: '斜体' },
  { name: 'strikethrough', label: 'S', title: '删除线' },
  { name: 'quote', label: '❝', title: '引用' },
  { name: 'inlineCode', label: '‹›', title: '行内代码' },
  { name: 'codeBlock', label: '{ }', title: '代码块' },
  { name: 'bulletList', label: '•—', title: '无序列表' },
  { name: 'orderedList', label: '1.', title: '有序列表' },
  { name: 'taskList', label: '☐', title: '任务列表' },
  { name: 'link', label: '🔗', title: '链接' },
  { name: 'table', label: '▦', title: '表格' },
  { name: 'mathInline', label: '∑', title: '行内公式' },
  { name: 'mathBlock', label: '∫', title: '块级公式' },
  { name: 'more', label: 'more', title: '插入 <!--more--> 摘要分隔' },
  { name: 'hr', label: '―', title: '分割线' },
]
