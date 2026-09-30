/**
 * 从已发布的站点抓取现有分类 / 标签，用于输入联想。
 * FixIt 的 taxonomy 页面是列表页，取链接文本即可；多语言站点会取到全部，
 * 解析失败时返回空数组而不是抛错（离线也能继续写文章）。
 */
export interface TaxonomyIndex {
  categories: string[]
  tags: string[]
}

function absolute(siteUrl: string, path: string): string {
  return new URL(path.replace(/^\//, ''), siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`).href
}

function extractNames(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const names = new Set<string>()
  doc.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href') ?? ''
    // 只保留指向具体分类/标签详情页的链接，跳过 /categories/ 自身
    if (!/\/(categories|tags)\/[^/]+\/?$/.test(href)) return
    const text = (a.textContent ?? '').trim()
    if (!text) return
    // 去掉 FixIt 计数徽标（如 "数学 12"）
    const cleaned = text.replace(/\s*\d+\s*$/, '').trim()
    if (cleaned && cleaned.length < 60) names.add(cleaned)
  })
  return [...names]
}

async function fetchFirst(urls: string[]): Promise<string | null> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      if (res.ok) return await res.text()
    } catch {
      // 继续尝试下一个
    }
  }
  return null
}

export async function fetchTaxonomies(siteUrl: string): Promise<TaxonomyIndex> {
  const [catHtml, tagHtml] = await Promise.all([
    fetchFirst([absolute(siteUrl, 'categories/'), absolute(siteUrl, 'zh-cn/categories/')]),
    fetchFirst([absolute(siteUrl, 'tags/'), absolute(siteUrl, 'zh-cn/tags/')]),
  ])
  return {
    categories: catHtml ? extractNames(catHtml) : [],
    tags: tagHtml ? extractNames(tagHtml) : [],
  }
}
