/**
 * 用 Chrome DevTools 协议驱动无头浏览器做交互验证。
 * 用法：
 *   node tools/cdp-check.mjs <url> <截图路径> [点击的选择器] [点击前执行的JS]
 *
 * 之所以不用 --screenshot 直出：那只能证明「页面渲染了」，
 * 证明不了「点返回按钮会弹出保存草稿询问」这类交互。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [, , url, shotPath, selector, preScript, afterSelector] = process.argv
const port = 9222 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), 'cdp-'))

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=560,900',
    url,
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return res.json()
}

async function waitForTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJson('/json/list')
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // 还没起来
    }
    await sleep(250)
  }
  throw new Error('等不到可调试的页面')
}

/** 极简 CDP 客户端：够用即可，不引入依赖 */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = (e) => reject(new Error(`WebSocket 连接失败: ${e.message ?? ''}`))
  })
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id
      pending.set(msgId, { resolve, reject })
      ws.send(JSON.stringify({ id: msgId, method, params }))
    })
  return { send, close: () => ws.close() }
}

async function main() {
  const page = await waitForTarget()
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  // 等应用挂载完成
  for (let i = 0; i < 30; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'document.querySelector(".screen") ? "ready" : "no"',
      returnByValue: true,
    })
    if (r.result.value === 'ready') break
    await sleep(300)
  }

  const report = []
  const evalIn = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }

  report.push(['顶部横幅', await evalIn('document.querySelector(".update-bar") ? "有新版本可用(不应该出现)" : "无更新提示(正确)"')])

  if (preScript) {
    report.push(['执行前置脚本', await evalIn(preScript)])
    await sleep(500)
    report.push([
      '列表草稿数(改动前)',
      await evalIn('document.querySelectorAll(".post-row.draft").length'),
    ])
  }

  if (selector) {
    report.push(['点击前是否已有弹窗', await evalIn('document.querySelector(".sheet") ? "有" : "无"')])
    await evalIn(`document.querySelector(${JSON.stringify(selector)}).click(), "clicked"`)
    await sleep(600)
    report.push(['点击后弹窗', await evalIn('document.querySelector(".sheet-title")?.textContent ?? "没有弹出"')])
    report.push([
      '弹窗选项',
      await evalIn(
        'Array.from(document.querySelectorAll(".sheet-actions button")).map(b => b.textContent).join(" | ")',
      ),
    ])
  }

  // 可选：再点一次（例如点弹窗里的某个选项），然后回到列表页统计草稿数
  if (afterSelector) {
    await evalIn(`document.querySelector(${JSON.stringify(afterSelector)}).click(), "clicked2"`)
    await sleep(1500)
    report.push(['第二次点击后所在的页面', await evalIn('location.hash || "#/"')])
    report.push([
      '当前页面的弹窗',
      await evalIn('document.querySelector(".sheet-title")?.textContent ?? "无"'),
    ])
    // 直接数本机草稿（不依赖列表是否已渲染）
    const draftCount = await evalIn(`(async () => {
      const keys = await new Promise((resolve, reject) => {
        const req = indexedDB.open('keyval-store')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('keyval', 'readonly')
          const all = tx.objectStore('keyval').getAllKeys()
          all.onsuccess = () => resolve(all.result)
          all.onerror = () => reject(all.error)
        }
        req.onerror = () => reject(req.error)
      })
      const drafts = keys.filter((k) => String(k).startsWith('gutun-draft:'))
      const recoveries = keys.filter((k) => String(k).startsWith('gutun-recovery:'))
      return '草稿 ' + drafts.length + ' 条 / 恢复快照 ' + recoveries.length + ' 条'
    })()`)
    report.push(['IndexedDB 状态', draftCount])
  }

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(shotPath, Buffer.from(shot.data, 'base64'))

  console.log('=== 交互验证结果 ===')
  for (const [k, v] of report) console.log(`${k}: ${v}`)
  console.log(`截图已保存: ${shotPath}`)

  cdp.close()
  chrome.kill()
}

main().catch((err) => {
  console.error('失败:', err.message)
  chrome.kill()
  process.exit(1)
})
