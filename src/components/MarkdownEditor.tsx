import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder,
  drawSelection,
  highlightSpecialChars,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export interface MarkdownEditorHandle {
  view: EditorView | null
  focus: () => void
}

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** 供父组件拿到 EditorView，用于插入 Markdown 片段 */
  onReady?: (view: EditorView) => void
  minHeight?: string
}

/** 与 App 主题联动的 Markdown 高亮风格 */
const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.35em', fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading2, fontSize: '1.22em', fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading3, fontSize: '1.1em', fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.heading4, fontWeight: '700', color: 'var(--cm-heading)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--cm-strong)' },
  { tag: t.emphasis, fontStyle: 'italic', color: 'var(--cm-em)' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--cm-link)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--cm-link)' },
  { tag: t.monospace, color: 'var(--cm-code)' },
  { tag: t.quote, color: 'var(--cm-quote)' },
  { tag: t.list, color: 'var(--cm-mark)' },
  { tag: t.contentSeparator, color: 'var(--cm-mark)' },
  { tag: t.processingInstruction, color: 'var(--cm-mark)' },
])

/**
 * 基于 CodeMirror 6 的 Markdown 编辑器。
 * 受控组件：外部 value 变化（如切换文章）时重建文档，日常输入不回流，
 * 避免中文输入法组合过程中被 React 打断。
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  onReady,
  minHeight = '48vh',
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const externalRef = useRef(value)

  onChangeRef.current = onChange

  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        drawSelection(),
        highlightSpecialChars(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(markdownHighlight, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        cmPlaceholder(placeholder ?? ''),
        EditorView.contentAttributes.of({
          autocapitalize: 'sentences',
          autocorrect: 'on',
          spellcheck: 'false',
        }),
        EditorView.theme({
          '&': { fontSize: '16px', backgroundColor: 'transparent' },
          '.cm-content': {
            fontFamily: 'var(--font-mono)',
            lineHeight: '1.75',
            padding: '12px 0',
            caretColor: 'var(--accent)',
          },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)' },
          '.cm-line': { padding: '0 2px' },
          '&.cm-focused': { outline: 'none' },
          '.cm-placeholder': { color: 'var(--text-faint)' },
          '.cm-cursor': { borderLeftWidth: '2px', borderLeftColor: 'var(--accent)' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const next = update.state.doc.toString()
            externalRef.current = next
            onChangeRef.current(next)
          }
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    onReady?.(view)
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在挂载时创建；外部切换文章通过下面的 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value === externalRef.current) return
    externalRef.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
  }, [value])

  return <div className="markdown-editor" style={{ minHeight }} ref={hostRef} />
}
