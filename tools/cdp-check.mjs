/**
 * 用 Chrome DevTools 协议驱动无头浏览器做交互与集成验证。
 *
 * 用法：
 *   node tools/cdp-check.mjs <url> <截图路径> [点击的选择器] [点击前执行的JS] [点击后再点的选择器]
 *   CDP_STEPS='[["说明","JS表达式",等待毫秒], ...]' node tools/cdp-check.mjs <url> <截图路径>
 *
 * CDP_STEPS 用来做多步集成验证（例如：进列表 → 读缓存 → 手动刷新 → 看请求计数），
 * 每步都是一个在页面里求值的表达式，结果会打印出来。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [, , url, shotPath, selector, preScript, afterSelector] = process.argv
const steps = process.env.CDP_STEPS ? JSON.parse(process.env.CDP_STEPS) : null
/** 额外等待条件：页面里这个表达式返回真值后才开始执行步骤（用于等 mock/数据就绪） */
const waitFor = process.env.CDP_WAIT_FOR ?? 'document.querySelector(".screen") ? true : false'
const port = 9222 + Math.floor(Math.random() * 500)
const profile = process.env.CDP_PROFILE ?? mkdtempSync(join(tmpdir(), 'cdp-'))

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

  // 等页面进入可操作状态（默认等 .screen 出现；mock 场景可改成等 __mockGithub）
  let ready = false
  for (let i = 0; i < 60; i++) {
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: waitFor,
        returnByValue: true,
      })
      if (r.result?.value === true) {
        ready = true
        break
      }
    } catch {
      // 页面还在加载/切换，继续等
    }
    await sleep(300)
  }
  if (!ready) console.log(`提示：等待条件「${waitFor}」超时，仍继续执行`)

  const report = []
  const evalIn = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (r.exceptionDetails) {
      const ex = r.exceptionDetails
      const detail =
        ex.exception?.description ??
        ex.exception?.value ??
        `${ex.text}${ex.lineNumber !== undefined ? ` @第 ${ex.lineNumber + 1} 行` : ''}`
      throw new Error(`页面内报错：${detail}`)
    }
    return r.result.value
  }

  report.push(['顶部横幅', await evalIn('document.querySelector(".update-bar") ? "有新版本可用(不应该出现)" : "无更新提示(正确)"')])

  if (steps) {
    for (const [label, expression, waitMs] of steps) {
      const value = await evalIn(expression)
      report.push([label, value])
      await sleep(waitMs ?? 400)
    }
  }

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
