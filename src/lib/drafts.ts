/**
 * 离线草稿：用 IndexedDB 保存，断网也能继续写，联网后再发布。
 * 保存的是「front matter JSON + 正文」，不含 Token。
 */
import { del, get, keys, set } from 'idb-keyval'
import type { FrontMatter } from '../types'

const PREFIX = 'gutun-draft:'

export interface Draft {
  id: string
  title: string
  /** 仓库内目标路径，例如 content/posts/diary20260927.md */
  path: string
  /** 已有文章的 sha（草稿若对应已发布文章，发布时用它做更新） */
  sha: string | null
  frontMatter: FrontMatter
  body: string
  createdAt: number
  updatedAt: number
  /** 是否是从仓库里打开的文章（而非全新草稿） */
  existing: boolean
}

export function newDraftId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function saveDraft(draft: Draft): Promise<void> {
  await set(`${PREFIX}${draft.id}`, { ...draft, updatedAt: Date.now() })
}

export async function loadDraft(id: string): Promise<Draft | undefined> {
  return get<Draft>(`${PREFIX}${id}`)
}

export async function deleteDraft(id: string): Promise<void> {
  await del(`${PREFIX}${id}`)
}

export async function listDrafts(): Promise<Draft[]> {
  const allKeys = (await keys()).filter(
    (k): k is string => typeof k === 'string' && k.startsWith(PREFIX),
  )
  const drafts = await Promise.all(allKeys.map((k) => get<Draft>(k)))
  return drafts
    .filter((d): d is Draft => Boolean(d))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function draftSummary(draft: Draft): string {
  const text = draft.body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 80)
}
