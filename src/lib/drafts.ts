/**
 * 离线草稿 + 未落盘内容的恢复快照。
 *
 * 两类数据分开存，避免互相干扰：
 *   - 草稿（draft）：用户在列表页「本机草稿」里能看到、能继续写的
 *   - 恢复快照（recovery）：编辑过程中悄悄留的一份，防止 App 被系统杀掉丢内容；
 *     它**不会**出现在草稿列表里，用户选择「不保存」时会一并清掉
 */
import { del, get, keys, set } from 'idb-keyval'
import type { FrontMatter } from '../types'

const DRAFT_PREFIX = 'gutun-draft:'
const RECOVERY_PREFIX = 'gutun-recovery:'

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

/* ------------------------------------------------------------------ 草稿 */

export async function saveDraft(draft: Draft): Promise<void> {
  await set(`${DRAFT_PREFIX}${draft.id}`, { ...draft, updatedAt: Date.now() })
}

export async function loadDraft(id: string): Promise<Draft | undefined> {
  return get<Draft>(`${DRAFT_PREFIX}${id}`)
}

export async function deleteDraft(id: string): Promise<void> {
  await del(`${DRAFT_PREFIX}${id}`)
}

export async function listDrafts(): Promise<Draft[]> {
  const allKeys = (await keys()).filter(
    (k): k is string => typeof k === 'string' && k.startsWith(DRAFT_PREFIX),
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

/* ------------------------------------------------- 恢复快照（内部机制，不是草稿） */

export async function saveRecovery(snapshot: Draft): Promise<void> {
  try {
    await set(`${RECOVERY_PREFIX}${snapshot.id}`, { ...snapshot, updatedAt: Date.now() })
  } catch {
    // 写不进去不影响正常编辑
  }
}

export async function loadRecovery(id: string): Promise<Draft | undefined> {
  try {
    return await get<Draft>(`${RECOVERY_PREFIX}${id}`)
  } catch {
    return undefined
  }
}

export async function deleteRecovery(id: string): Promise<void> {
  try {
    await del(`${RECOVERY_PREFIX}${id}`)
  } catch {
    // 忽略
  }
}

/** 所有恢复快照，用于启动时提示「上次没写完」 */
export async function listRecoveries(): Promise<Draft[]> {
  try {
    const allKeys = (await keys()).filter(
      (k): k is string => typeof k === 'string' && k.startsWith(RECOVERY_PREFIX),
    )
    const items = await Promise.all(allKeys.map((k) => get<Draft>(k)))
    return items.filter((d): d is Draft => Boolean(d))
  } catch {
    return []
  }
}

/** 把快照提升为正式草稿，并清掉快照本身 */
export async function promoteRecoveryToDraft(draft: Draft): Promise<void> {
  await saveDraft(draft)
  await deleteRecovery(draft.id)
}
