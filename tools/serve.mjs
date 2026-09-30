/**
 * 零依赖静态服务器：把构建好的 dist/ 发布到局域网，手机浏览器直接访问。
 *
 *   npm run build
 *   npm run serve          # 监听 0.0.0.0:4180，自动打印手机可访问的地址
 *   npm run serve -- 8080  # 指定端口
 *
 * 注意：局域网是 http://，浏览器不把 http 视为「安全上下文」，
 * 因此只能用浏览器打开、不能「添加到主屏幕」安装成 App。
 * 想要真正安装到手机桌面，请把 dist/ 部署到 GitHub Pages（HTTPS）后安装。
 */
import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../dist', import.meta.url)))
const port = Number(process.argv[2] ?? process.env.PORT ?? 4180)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function safeFile(urlPath) {
  let pathname
  try {
    pathname = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname)
  } catch {
    return null
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  // 阻止 ../ 跳出 dist
  const target = resolve(root, `.${normalize(pathname)}`)
  if (!target.startsWith(root)) return null
  try {
    const info = await stat(target)
    if (info.isDirectory()) return safeFile(`${pathname.replace(/\/?$/, '/')}index.html`)
    return target
  } catch {
    return null
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  const file = await safeFile(req.url ?? '/')
  if (!file) {
    // 单页应用：未知路径一律交给 index.html（hash 路由自己处理）
    const fallback = join(root, 'index.html')
    try {
      const html = await readFile(fallback)
      res.writeHead(200, { 'content-type': MIME['.html'] })
      res.end(html)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('dist/ 还没有构建，请先运行 npm run build')
    }
    return
  }
  // ?seed=1 时注入一段脚本，往当前源的 IndexedDB 写一条演示草稿，
  // 方便在没有 Token 的情况下点开「本机草稿」看编辑与预览效果。
  if (requestUrl.searchParams.has('seed') && file.endsWith('index.html')) {
    const html = await readFile(file, 'utf8')
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
    res.end(html.replace('</body>', `${SEED_SCRIPT}</body>`))
    return
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  })
  createReadStream(file).pipe(res)
})

function lanAddresses() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address)
    }
  }
  return out
}

/** 演示草稿：纯本地数据，不发往任何地方，用来在没有 Token 时体验编辑器 */
const SEED_SCRIPT = `
<script>
(function () {
  var body = [
    '## 二级标题',
    '',
    '这是 **粗体**、*斜体* 和 \`行内代码\`，以及一个[外链](https://gohugo.io)。',
    '',
    '行内公式 $a_1 = b_2$，块级公式：',
    '',
    '$$',
    '\\\\int_0^1 x^2 \\\\, dx = \\\\frac{1}{3}',
    '$$',
    '',
    '> 引用一行，用来确认样式。',
    '',
    '- 列表一',
    '- [ ] 待办事项',
    '- [x] 已完成事项',
    '',
    '| 列 1 | 列 2 |',
    '| --- | --- |',
    '| a | b |',
    '',
    '\`\`\`js',
    'const answer = 42',
    '\`\`\`',
    ''
  ].join('\\n');
  var draft = {
    id: 'd-demo-seed',
    title: '演示草稿：排版与公式',
    path: 'content/posts/demo.md',
    sha: null,
    frontMatter: {
      title: '演示草稿：排版与公式', subtitle: '', date: new Date().toISOString(),
      slug: 'demo001', draft: false,
      author: { name: 'GUTUN', link: '', email: '', avatar: '' },
      description: '', keywords: [], license: '', comment: false, weight: 0,
      tags: ['演示'], categories: ['演示'], hiddenFromHomePage: false,
      hiddenFromSearch: false, hiddenFromRelated: false, hiddenFromFeed: false,
      summary: '', toc: true, math: true, lightgallery: false, password: '',
      message: '', repost: { enable: true, url: '' }, extra: {}
    },
    body: body,
    createdAt: Date.now(), updatedAt: Date.now(), existing: false
  };
  var req = indexedDB.open('keyval-store');
  req.onupgradeneeded = function () { req.result.createObjectStore('keyval'); };
  req.onsuccess = function () {
    var db = req.result;
    var tx = db.transaction('keyval', 'readwrite');
    tx.objectStore('keyval').put(draft, 'gutun-draft:d-demo-seed');
    tx.oncomplete = function () {
      var el = document.createElement('div');
      el.textContent = '演示草稿已写入本机，正在打开…';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#5bbad5;color:#fff;padding:6px;font:12px sans-serif;text-align:center';
      document.body.appendChild(el);
      location.hash = '#/edit/draft:d-demo-seed';
    };
  };
})();
</script>
`

server.listen(port, '0.0.0.0', () => {
  console.log(`\n  本机：      http://localhost:${port}/`)
  for (const ip of lanAddresses()) {
    console.log(`  同一 WiFi： http://${ip}:${port}/   ← 手机浏览器打开这个`)
  }
  console.log('\n  提示：局域网是 http，浏览器不会把它当作安全上下文，')
  console.log('        所以「添加到主屏幕」装不了；要装成 App 请部署到 GitHub Pages。\n')
})
