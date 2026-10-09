import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The upstream also has synthetic IDs (e.g. customdogtags12345678910).
const ID = /^[a-z0-9]{16,48}$/
const KINDS = { icon: 'iconLink', grid: 'gridImageLink' }
const MAX_IMAGE = 8 * 1024 * 1024

export function assetUrl(id, url) {
  if (!ID.test(id) || typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 'assets.tarkov.dev' && !parsed.port
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
      && /^\/[a-z0-9]{16,48}-(icon|grid-image)\.(webp|jpg|jpeg|png)$/.test(parsed.pathname) ? parsed.href : null
  } catch { return null }
}

export function isWebp(bytes) {
  return bytes.length >= 20 && bytes.length <= MAX_IMAGE && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length
}

export function isImage(bytes, extension) {
  if (bytes.length < 20 || bytes.length > MAX_IMAGE) return false
  if (extension === 'webp') return isWebp(bytes)
  if (extension === 'jpg' || extension === 'jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217
  if (extension === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  return false
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`)
  return response.json()
}

async function atomic(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temporary, data, { mode: 0o644 }); await rename(temporary, path) }
  finally { await unlink(temporary).catch(() => {}) }
}

async function image(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Image HTTP ${response.status}`)
  const extension = url.split('.').at(-1)
  const mime = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`
  if (response.headers.get('content-type')?.toLowerCase().split(';')[0] !== mime) throw new Error('Unexpected image type')
  if (Number(response.headers.get('content-length')) > MAX_IMAGE) throw new Error('Image too large')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > MAX_IMAGE) throw new Error('Image too large')
    chunks.push(chunk)
  }
  const bytes = Buffer.concat(chunks)
  if (!isImage(bytes, extension)) throw new Error('Invalid image')
  return bytes
}

export async function cacheItemImages(directory, concurrency = 6) {
  const root = resolve(directory)
  await mkdir(root, { recursive: true, mode: 0o755 })
  let previous = { items: {} }
  try { previous = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) } catch { /* first run */ }
  const rows = new Map()
  for (const mode of ['regular', 'pve', 'pvp-season']) {
    const payload = await json(`https://json.tarkov.dev/${mode}/items`)
    const entries = Object.values(payload?.data?.items ?? {})
    if (entries.length < 1000) throw new Error(`Incomplete ${mode} catalog; keeping previous cache`)
    await atomic(join(root, `catalog-${mode}.json`), `${JSON.stringify(payload)}\n`)
    for (const row of entries) if (ID.test(row.id) && !rows.has(row.id)) rows.set(row.id, row)
  }
  const dictionaries = await Promise.all(['ru', 'en'].map(async lang => (await json(`https://json.tarkov.dev/regular/items_${lang}`)).data))
  for (const [index, lang] of ['ru', 'en'].entries()) await atomic(join(root, `names-${lang}.json`), `${JSON.stringify(dictionaries[index])}\n`)
  const manifest = { source: 'json.tarkov.dev', updatedAt: new Date().toISOString(), items: {} }
  const jobs = []
  for (const [id, row] of rows) {
    const names = [...new Set(dictionaries.flatMap(dict => [dict?.[`${id} Name`], dict?.[`${id} ShortName`]]).filter(name => typeof name === 'string' && name.trim()))]
    manifest.items[id] = { names, width: row.width, height: row.height, images: {} }
    for (const [kind, field] of Object.entries(KINDS)) jobs.push({ id, kind, url: assetUrl(id, row[field]) })
  }
  let next = 0, saved = 0, reused = 0
  const missing = []
  await Promise.all(Array.from({ length: Math.max(1, Math.min(12, concurrency)) }, async () => {
    for (;;) {
      const job = jobs[next++]
      if (!job) return
      const { id, kind, url } = job
      const extension = url?.split('.').at(-1) ?? 'webp'
      const file = `${id}-${kind}.${extension}`
      const old = previous.items?.[id]?.images?.[kind]
      let existing
      try { existing = await readFile(join(root, file)) } catch { /* missing image */ }
      const digest = bytes => createHash('sha256').update(bytes).digest('hex')
      const good = existing && isImage(existing, extension) && old?.sha256 === digest(existing)
      let record = good ? old : undefined
      if (good && old.url === url && Date.now() - Date.parse(old.cachedAt) < 7 * 24 * 60 * 60 * 1000) reused++
      else {
        let failure = url ? 'Download failed' : 'No valid upstream image'
        if (url) for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const bytes = await image(url)
            await atomic(join(root, file), bytes)
            record = { file, url, bytes: bytes.length, sha256: digest(bytes), cachedAt: new Date().toISOString() }
            saved++
            failure = ''
            break
          } catch (error) {
            failure = error.message
            await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
          }
        }
        if (failure) missing.push({ id, kind, reason: failure, previousKept: !!record })
      }
      if (record) manifest.items[id].images[kind] = record
      if ((saved + reused + missing.length) % 250 === 0) console.log(`Images ${saved + reused + missing.length}/${jobs.length}`)
    }
  }))
  await atomic(join(root, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
  const report = { items: rows.size, images: Object.values(manifest.items).reduce((sum, row) => sum + Object.keys(row.images).length, 0), saved, reused, missing }
  await atomic(join(root, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ ...report, missing: missing.length }))
  return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/cache-item-images.mjs <cache directory>')
  await cacheItemImages(process.argv[2])
}
