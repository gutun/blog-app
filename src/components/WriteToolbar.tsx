import { useRef, useState } from 'react'
import type { EditorView } from '@codemirror/view'
import { TOOLBAR_ITEMS, insertAtCursor, markdownActions } from '../lib/editor-actions'
import type { MarkdownActionName } from '../lib/editor-actions'

interface Props {
  getView: () => EditorView | null
  /** 选择图片后由父组件负责压缩、上传、插入链接 */
  onPickImage: (file: File) => void
  /** 是否显示公式按钮（与 front matter 的 math 字段联动） */
  mathEnabled: boolean
  busyImage?: boolean
}

/** 编辑区上方的 Markdown 工具栏；横向滚动，按钮用 pointerdown 以免键盘收起 */
export function WriteToolbar({ getView, onPickImage, mathEnabled, busyImage }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [expanded, setExpanded] = useState(false)

  const run = (name: MarkdownActionName) => {
    const view = getView()
    if (!view) return
    markdownActions[name](view)
  }

  const items = TOOLBAR_ITEMS.filter((item) =>
    mathEnabled ? true : !item.name.startsWith('math'),
  )
  const visible = expanded ? items : items.slice(0, 10)

  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <button
          type="button"
          className="tool-btn"
          disabled={busyImage}
          onPointerDown={(e) => {
            e.preventDefault()
            fileRef.current?.click()
          }}
          title="插入图片"
        >
          {busyImage ? '…' : '🖼'}
        </button>
        <button
          type="button"
          className="tool-btn"
          onPointerDown={(e) => {
            e.preventDefault()
            const view = getView()
            if (view) insertAtCursor(view, '\n<!--more-->\n\n')
          }}
          title="摘要分隔符"
        >
          ✂
        </button>
        {visible.map((item) => (
          <button
            type="button"
            key={item.name}
            className="tool-btn"
            title={item.title}
            onPointerDown={(e) => {
              e.preventDefault()
              run(item.name)
            }}
          >
            {item.label}
          </button>
        ))}
        {items.length > visible.length && (
          <button
            type="button"
            className="tool-btn more"
            onPointerDown={(e) => {
              e.preventDefault()
              setExpanded(true)
            }}
          >
            更多 ›
          </button>
        )}
        {expanded && (
          <button
            type="button"
            className="tool-btn more"
            onPointerDown={(e) => {
              e.preventDefault()
              setExpanded(false)
            }}
          >
            ‹ 收起
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onPickImage(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
