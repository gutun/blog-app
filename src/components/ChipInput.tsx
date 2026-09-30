import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'

interface Props {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  /** 已有分类 / 标签，用于快速点选 */
  suggestions?: string[]
  placeholder?: string
  /** 是否允许一键「使用全部候选」 */
  hint?: string
}

/** 分类 / 标签输入：回车或逗号确认，可点候选补全，也支持自由输入新词 */
export function ChipInput({
  label,
  values,
  onChange,
  suggestions = [],
  placeholder,
  hint,
}: Props) {
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase()
    return suggestions
      .filter((s) => !values.includes(s))
      .filter((s) => (q ? s.toLowerCase().includes(q) : true))
      .slice(0, 30)
  }, [suggestions, values, text])

  const add = (raw: string) => {
    const value = raw.trim().replace(/^[,\s]+|[,\s]+$/g, '')
    if (!value) return
    if (!values.includes(value)) onChange([...values, value])
    setText('')
  }

  const remove = (value: string) => onChange(values.filter((v) => v !== value))

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && values.length) {
      onChange(values.slice(0, -1))
    }
  }

  return (
    <div className="field">
      <div className="field-head">
        <label>{label}</label>
        {hint ? <span className="field-hint">{hint}</span> : null}
      </div>

      {values.length > 0 && (
        <div className="chips">
          {values.map((v) => (
            <span className="chip" key={v}>
              {v}
              <button type="button" aria-label={`移除 ${v}`} onClick={() => remove(v)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        className="text-input"
        value={text}
        placeholder={placeholder ?? '输入后回车确认'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 延迟关闭，让候选按钮的 click 先触发
          window.setTimeout(() => setOpen(false), 180)
          if (text.trim()) add(text)
        }}
        enterKeyHint="done"
      />

      {open && filtered.length > 0 && (
        <div className="suggestions">
          {filtered.map((s) => (
            <button type="button" key={s} className="suggestion" onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
