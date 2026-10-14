// External requests of the page answered by curl (it trusts the agent proxy's CA; the bundled Chromium does not),
// cached on disk so every take loads the same catalog and images fast.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

import { S } from './env.mjs'
const CACHE = `${S}/promo/netcache`
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }
let inflight = 0
const waiting = []
const slot = () => (inflight < 12 ? (inflight++, Promise.resolve()) : new Promise((resolve) => waiting.push(resolve)).then(() => { inflight++ }))
const free = () => { inflight--; waiting.shift()?.() }

function curl(url, method, body, contentType, out, headers) {
  const args = ['-sS', '-L', '--compressed', '-m', '180', '-D', headers, '-o', out, '-X', method, '-A', 'Mozilla/5.0 RaidOS-promo']
  if (body) { args.push('-H', `Content-Type: ${contentType || 'application/json'}`, '--data-binary', '@-') }
  args.push(url)
  return new Promise((resolve) => {
    const child = execFile('curl', args, { maxBuffer: 1 << 20 }, (error) => resolve(!error))
    if (body) { child.stdin.end(body) } else child.stdin.end()
  })
}

export const stats = { hit: 0, miss: 0, fail: 0 }
export async function answerExternal(context, isLocal, block = () => false) {
  await context.route((url) => /^https?:/.test(url.href) && !isLocal(url.href), async (route) => {
    const request = route.request()
    const url = request.url()
    if (block(url)) return route.abort()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = request.postData() ?? ''
    const key = createHash('sha1').update(`${request.method()} ${url} ${body}`).digest('hex')
    const file = `${CACHE}/${key}`
    if (!existsSync(`${file}.meta`)) {
      stats.miss++
      await slot()
      try {
        const ok = await curl(url, request.method(), body, request.headers()['content-type'], `${file}.body`, `${file}.hdr`)
        const head = existsSync(`${file}.hdr`) ? readFileSync(`${file}.hdr`, 'utf8') : ''
        // The last response of a redirect chain.
        const blocks = head.split(/\r?\n\r?\n/).filter((block) => /^HTTP\//.test(block.trim()))
        const last = blocks.at(-1) ?? ''
        const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(last.trim())?.[1] ?? 0)
        const type = /\ncontent-type:\s*([^\r\n]+)/i.exec(last)?.[1] ?? 'application/octet-stream'
        if (!ok || !status || !existsSync(`${file}.body`)) { stats.fail++; return route.abort() }
        writeFileSync(`${file}.meta`, JSON.stringify({ status, type, url }))
      } finally { free() }
    } else stats.hit++
    const meta = JSON.parse(readFileSync(`${file}.meta`, 'utf8'))
    return route.fulfill({ status: meta.status, headers: { ...CORS, 'content-type': meta.type }, body: readFileSync(`${file}.body`) })
  })
}
