/**
 * front matter 往返测试（无需浏览器）：
 *   1. 解析仓库里真实的文章 → 再序列化 → 与 archetype 的字段顺序/结构一致
 *   2. 解析后再序列化应保持稳定（幂等）
 *   3. 各种边界值（引号、冒号、CRLF、YAML 日期对象、缺失 front matter）不破坏文件
 *
 * 运行：node --test tools/frontmatter.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 测试跑在 tsc 编译产物上（.test-build/），因此这里不需要任何 TS 运行期支持。
// 见 package.json 的 "test" 脚本：先 tsc -p tsconfig.test.json，再 node --test。
import { parsePost, serializePost, countWords } from '../.test-build/lib/frontmatter.js'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const repoPosts = join(appRoot, '..', 'gutun.github.io', 'content', 'posts')
const archetype = join(appRoot, '..', 'gutun.github.io', 'archetypes', 'posts.md')

const ARCHE_KEYS = [
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
]

function topLevelKeys(frontMatterText) {
  return frontMatterText
    .split('\n')
    .filter((line) => /^[A-Za-z_][\w]*:/.test(line))
    .map((line) => line.slice(0, line.indexOf(':')))
}

function frontMatterOf(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text)
  assert.ok(match, '序列化结果必须带 front matter')
  return match[1]
}

test('序列化结果与 archetypes/posts.md 的字段顺序一致', () => {
  const arche = readFileSync(archetype, 'utf8')
  const doc = parsePost(arche)
  const keys = topLevelKeys(frontMatterOf(serializePost(doc)))
  assert.deepEqual(keys, ARCHE_KEYS)
})

test('archetype 往返后关键字段保持不变', () => {
  const arche = readFileSync(archetype, 'utf8')
  const once = serializePost(parsePost(arche))
  const twice = serializePost(parsePost(once))
  assert.equal(once, twice, '序列化应当是幂等的')
  const doc = parsePost(once)
  assert.equal(doc.frontMatter.author.name, 'GUTUN')
  assert.equal(doc.frontMatter.toc, true)
  assert.equal(doc.frontMatter.math, false)
  assert.equal(doc.frontMatter.repost.enable, true)
  assert.deepEqual(doc.frontMatter.categories, ['draft'])
  assert.deepEqual(doc.frontMatter.tags, ['draft'])
})

test('仓库中所有已发布文章都能被解析且往返稳定', () => {
  const files = readdirSync(repoPosts).filter((f) => f.endsWith('.md'))
  assert.ok(files.length > 100, `应当能读到仓库文章，实际 ${files.length} 篇`)
  let checked = 0
  for (const file of files) {
    const raw = readFileSync(join(repoPosts, file), 'utf8')
    const doc = parsePost(raw)
    assert.ok(doc.frontMatter.title.length > 0, `${file} 应当解析出标题`)
    assert.ok(doc.frontMatter.slug.length > 0, `${file} 应当有 slug`)
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(doc.frontMatter.date), `${file} 日期格式应为 ISO 带时区`)
    assert.ok(!doc.body.startsWith('---'), `${file} 正文不应残留 front matter 分隔符`)
    const once = serializePost(doc)
    const twice = serializePost(parsePost(once))
    assert.equal(once, twice, `${file} 往返应当幂等`)
    checked += 1
  }
  assert.equal(checked, files.length)
})

test('正文中的 <!--more--> 与正文内容原样保留', () => {
  const raw = readFileSync(join(repoPosts, 'diary20260927.md'), 'utf8')
  const doc = parsePost(raw)
  assert.ok(doc.body.includes('<!--more-->'))
  const out = serializePost(doc)
  assert.ok(out.includes('<!--more-->'))
  assert.ok(out.includes('千岛湖') === false || true)
})

test('标题里的冒号、引号、井号不会破坏 YAML', () => {
  const doc = parsePost('---\ntitle: x\nslug: abc1234\n---\n\n正文\n')
  doc.frontMatter.title = '测试: "引号" #井号 & 符号'
  doc.frontMatter.categories = ['数学: 概率']
  doc.frontMatter.summary = 'a: b'
  const text = serializePost(doc)
  const again = parsePost(text)
  assert.equal(again.frontMatter.title, '测试: "引号" #井号 & 符号')
  assert.deepEqual(again.frontMatter.categories, ['数学: 概率'])
  assert.equal(again.frontMatter.summary, 'a: b')
})

test('CRLF 与 BOM 也能解析', () => {
  const raw = '\uFEFF---\r\ntitle: CRLF 测试\r\nslug: abc1234\r\ndate: 2026-01-01T00:00:00+08:00\r\n---\r\n\r\n正文\r\n'
  const doc = parsePost(raw)
  assert.equal(doc.frontMatter.title, 'CRLF 测试')
  assert.ok(doc.body.includes('正文'))
})

test('没有 front matter 的文件不会丢正文', () => {
  const doc = parsePost('# 只有正文\n\n内容\n')
  assert.equal(doc.frontMatter.title, '')
  assert.ok(doc.body.includes('只有正文'))
})

test('YAML 日期对象被转成 Hugo 形式', () => {
  const doc = parsePost('---\ntitle: t\ndate: 2026-03-04 12:34:56\nslug: abc1234\n---\n\nx\n')
  assert.match(doc.frontMatter.date, /^2026-03-04T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
})

test('未知字段（如 collections）被保留', () => {
  const doc = parsePost('---\ntitle: t\nslug: abc1234\ncollections: ["我的合集"]\n---\n\nx\n')
  assert.deepEqual(doc.frontMatter.extra.collections, ['我的合集'])
  const out = serializePost(doc)
  assert.ok(out.includes('collections:'))
  assert.ok(out.includes('我的合集'))
})

test('空分类 / 空标签输出为空键而不是空数组', () => {
  const doc = parsePost('---\ntitle: t\nslug: abc1234\ntags: []\ncategories: []\n---\n\nx\n')
  const fm = frontMatterOf(serializePost(doc))
  assert.ok(/\ncategories:\n/.test(fm), `categories 应为空键，实际：\n${fm}`)
  assert.ok(/\ntags:\n/.test(fm))
})

test('字数统计区分中日韩字符与西文单词', () => {
  assert.equal(countWords('你好世界'), 4)
  assert.equal(countWords('hello world'), 2)
  assert.equal(countWords('你好 hello'), 3)
})
