#!/usr/bin/env node
/**
 * Item-info lookup bench: renders an EFT-like inventory with the game's name tooltip for every item of a catalog
 * (Russian and English names, short names too, at 1080p and 1440p, cursor drawn over the scene) and runs the real
 * pipeline on it — findTooltip → OCR variants → Tesseract (same settings as the app) → tooltip matcher.
 *
 *   node scripts/item-lookup-bench.mjs --tarkov-dev                     # catalog from json.tarkov.dev (needs internet)
 *   node scripts/item-lookup-bench.mjs --catalog catalog.json           # [{id,name,shortName,nameEn,shortNameEn,width,height,bg}]
 *   node scripts/item-lookup-bench.mjs --items items.json --ru ru.json --en en.json   # SPT locale files ("<id> Name")
 *
 * Options: --font <Bender .woff/.woff2/.ttf> (the game's font; falls back to a system sans), --sample N (every Nth
 * item), --limit N, --workers N (Tesseract workers, default 3), --pages N (browser pages drawing scenes, default 2), --out <dir> (report + failure crops),
 * --save-scenes N (full scene PNGs of the first N cases), --src <dir> (other copies of tooltipDetect.ts/itemMatch.ts,
 * to compare with an older version), --baseline (old matcher API: one language, fuzzy fallback), --detect-only
 * (tooltip detection only, no OCR: «correct» = the right box was found), --export <dir> (small PNG crops + cases.json
 * of every case, for the regression test in src/overlay/itemLookupRegression.test.ts).
 */
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cpus } from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const { chromium } = require('playwright')
const { createWorker } = require('tesseract.js')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const srcDir = resolve(option('src', join(root, 'src/overlay')))
const outDir = resolve(option('out', join(root, 'work/item-lookup-bench')))
const sample = Number(option('sample', '1'))
const limit = Number(option('limit', '0'))
const workers = Number(option('workers', String(Math.max(1, Math.min(3, cpus().length - 1)))))
const saveScenes = Number(option('save-scenes', '0'))
const baseline = flag('baseline')
const fontPath = option('font', '')
const detectOnly = flag('detect-only')
const exportDir = option('export', '')

// ---------------------------------------------------------------- catalog
async function loadCatalog() {
  if (option('catalog')) return JSON.parse(await readFile(option('catalog'), 'utf8'))
  if (option('items')) {
    const items = JSON.parse(await readFile(option('items'), 'utf8'))
    const ru = JSON.parse(await readFile(option('ru'), 'utf8'))
    const en = JSON.parse(await readFile(option('en'), 'utf8'))
    return (Array.isArray(items) ? items : Object.values(items)).flatMap((item) => {
      const name = ru[`${item.id} Name`], nameEn = en[`${item.id} Name`]
      return name && nameEn ? [{ id: item.id, name: name.trim(), shortName: (ru[`${item.id} ShortName`] ?? '').trim(), nameEn: nameEn.trim(), shortNameEn: (en[`${item.id} ShortName`] ?? '').trim(), width: item.width ?? 1, height: item.height ?? 1, bg: item.backgroundColor ?? 'default' }] : []
    })
  }
  if (flag('tarkov-dev')) {
    const get = async (path) => (await (await fetch(`https://json.tarkov.dev/regular/${path}`)).json()).data
    const [base, ru, en] = await Promise.all([get('items'), get('items_ru'), get('items_en')])
    return Object.values(base.items ?? base).flatMap((item) => {
      const name = ru[item.name] ?? item.name, nameEn = en[item.name]
      if (!name || !nameEn || / Name$/.test(name)) return []
      return [{ id: item.id, name, shortName: ru[item.shortName] ?? '', nameEn, shortNameEn: en[item.shortName] ?? '', width: item.width ?? 1, height: item.height ?? 1, bg: item.backgroundColor ?? 'default' }]
    })
  }
  throw new Error('Give a catalog: --catalog, --items/--ru/--en or --tarkov-dev')
}

// ---------------------------------------------------------------- pipeline sources
async function pageModule() {
  const source = stripTypeScriptTypes(await readFile(join(srcDir, 'tooltipDetect.ts'), 'utf8'))
  const body = source.replace(/^export /gm, '')
  const names = ['findTooltip', 'tooltipForOcr', 'ocrVariants', 'TOOLTIP_CAPTURE']
  return `window.TD = (() => { ${body}\n return { ${names.map((name) => `${name}: typeof ${name} === 'undefined' ? undefined : ${name}`).join(', ')} } })()`
}

// ---------------------------------------------------------------- in-page scene
/* The scene is drawn in the browser (canvas) and the detector runs there too, so only small OCR crops travel back. */
function inPage() {
  const COLORS = { black: [0, 0, 0], grey: [40, 40, 40], yellow: [95, 90, 20], green: [30, 80, 30], blue: [25, 50, 90], violet: [70, 30, 90], red: [100, 25, 25], orange: [110, 60, 15], tracerYellow: [95, 95, 25], default: [20, 22, 24] }
  const mulberry = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const grey = (value, alpha = 1) => `rgba(${value},${value},${value},${alpha})`

  function drawIcon(ctx, x, y, w, h, random) {
    const shapes = 3 + Math.floor(random() * 6) + Math.round((w * h) / 9000)
    for (let index = 0; index < shapes; index += 1) {
      const lum = 35 + random() * 170
      const tint = random() < 0.5 ? [lum, lum, lum] : [lum * 0.9, lum * 0.95, lum * 0.7]
      ctx.fillStyle = `rgb(${tint.map(Math.round).join(',')})`
      const cx = x + w * (0.15 + random() * 0.7), cy = y + h * (0.2 + random() * 0.65)
      const rx = w * (0.08 + random() * 0.35), ry = h * (0.06 + random() * 0.3)
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(random() * Math.PI)
      if (random() < 0.5) { ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill() } else ctx.fillRect(-rx, -ry, rx * 2, ry * 2)
      ctx.restore()
    }
    // Fine detail (straps, text on packs, rails).
    for (let index = 0; index < shapes * 3; index += 1) {
      ctx.strokeStyle = grey(Math.round(20 + random() * 200), 0.8)
      ctx.lineWidth = 1 + random() * 2
      ctx.beginPath()
      ctx.moveTo(x + random() * w, y + random() * h)
      ctx.lineTo(x + random() * w, y + random() * h)
      ctx.stroke()
    }
  }

  function drawItem(ctx, x, y, w, h, bg, label, u, random, font) {
    const [r, g, b] = COLORS[bg] ?? COLORS.default
    ctx.fillStyle = `rgba(${r},${g},${b},0.45)`
    ctx.fillRect(x, y, w, h)
    ctx.save()
    ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip()
    drawIcon(ctx, x + 3, y + 3, w - 6, h - 6, random)
    ctx.restore()
    ctx.strokeStyle = 'rgb(73,81,84)'
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
    if (label) {
      ctx.font = `${Math.round(10 * u)}px ${font}`
      ctx.fillStyle = 'rgb(205,205,200)'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(label.slice(0, 12), x + w - 3 * u, y + 2 * u)
      ctx.textAlign = 'left'
    }
  }

  function drawCursor(ctx, x, y, u) {
    const points = [[0, 0], [0, 17], [4, 13], [7, 20], [9.5, 19], [6.5, 12.5], [12, 12.5]]
    ctx.beginPath()
    points.forEach(([px, py], index) => (index ? ctx.lineTo(x + px * u, y + py * u) : ctx.moveTo(x + px * u, y + py * u)))
    ctx.closePath()
    ctx.fillStyle = '#f2f2f2'
    ctx.fill()
    ctx.strokeStyle = '#000'
    ctx.lineWidth = Math.max(1, u)
    ctx.stroke()
  }

  /** Draws one inventory scene; returns where the cursor and the tooltip are. */
  function drawScene(ctx, spec) {
    const { W, H, u, font } = spec
    const random = mulberry(spec.seed)
    const pitch = Math.round(63 * u)
    const base = 14 + Math.floor(random() * 14)
    ctx.fillStyle = grey(base)
    ctx.fillRect(0, 0, W, H)
    for (let index = 0; index < 300; index += 1) { ctx.fillStyle = grey(Math.round(random() * 60), 0.08); ctx.fillRect(random() * W, random() * H, random() * 200 * u, random() * 120 * u) }
    // Stash grid.
    const cols = Math.floor((W - 40 * u) / pitch), rows = Math.floor((H - 40 * u) / pitch)
    const gx = Math.round((W - cols * pitch) / 2), gy = Math.round((H - rows * pitch) / 2)
    for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
      ctx.fillStyle = grey(22 + Math.floor(random() * 6))
      ctx.fillRect(gx + col * pitch + 1, gy + row * pitch + 1, pitch - 1, pitch - 1)
    }
    ctx.fillStyle = 'rgb(66,73,76)'
    for (let row = 0; row <= rows; row += 1) ctx.fillRect(gx, gy + row * pitch, cols * pitch + 1, 1)
    for (let col = 0; col <= cols; col += 1) ctx.fillRect(gx + col * pitch, gy, 1, rows * pitch + 1)
    // The hovered item somewhere in the middle, other items around it.
    const used = new Set()
    const take = (col, row, w, h) => {
      for (let y = row; y < row + h; y += 1) for (let x = col; x < col + w; x += 1) if (x >= cols || y >= rows || used.has(`${x},${y}`)) return false
      for (let y = row; y < row + h; y += 1) for (let x = col; x < col + w; x += 1) used.add(`${x},${y}`)
      return true
    }
    const tw = Math.min(spec.item.width, cols - 2), th = Math.min(spec.item.height, rows - 2)
    const tcol = Math.floor(cols * 0.2 + random() * Math.max(1, cols * 0.6 - tw)), trow = Math.floor(rows * 0.2 + random() * Math.max(1, rows * 0.6 - th))
    take(tcol, trow, tw, th)
    const target = { x: gx + tcol * pitch, y: gy + trow * pitch, w: tw * pitch + 1, h: th * pitch + 1 }
    for (let index = 0; index < cols * rows * 0.35; index += 1) {
      const w = 1 + Math.floor(random() * random() * 3), h = 1 + Math.floor(random() * random() * 3)
      const col = Math.floor(random() * cols), row = Math.floor(random() * rows)
      if (take(col, row, w, h)) drawItem(ctx, gx + col * pitch, gy + row * pitch, w * pitch + 1, h * pitch + 1, Object.keys(COLORS)[Math.floor(random() * 10)], spec.labels[Math.floor(random() * spec.labels.length)], u, random, font)
    }
    drawItem(ctx, target.x, target.y, target.w, target.h, spec.item.bg, spec.shortLabel, u, random, font)
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.fillRect(target.x, target.y, target.w, target.h)
    const cursor = { x: Math.round(target.x + target.w * (0.15 + random() * 0.7)), y: Math.round(target.y + target.h * (0.15 + random() * 0.7)) }

    // A container window header nearby (a dark framed bar with capitals) — must not be taken for the tooltip.
    if (random() < 0.35) {
      const dx = (random() < 0.5 ? -1 : 1) * (160 + random() * 300) * u, dy = (random() < 0.5 ? -1 : 1) * (90 + random() * 160) * u
      const bw = Math.round((260 + random() * 160) * u), bh = Math.round(24 * u)
      const bx = Math.round(cursor.x + dx), by = Math.round(cursor.y + dy)
      ctx.fillStyle = 'rgba(8,9,9,0.95)'; ctx.fillRect(bx, by, bw, bh)
      ctx.strokeStyle = grey(120); ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1)
      ctx.font = `${Math.round(13 * u)}px ${font}`; ctx.fillStyle = grey(200); ctx.textBaseline = 'middle'
      ctx.fillText(random() < 0.5 ? 'РЮКЗАК' : 'TACTICAL RIG', bx + 30 * u, by + bh / 2)
    }

    let tooltip = null
    if (!spec.noTooltip) {
      const size = Math.round(13 * u * (0.93 + random() * 0.17))
      ctx.font = `${size}px ${font}`
      const textWidth = Math.ceil(ctx.measureText(spec.text).width)
      const padX = Math.round((11 + random() * 6) * u)
      const h = Math.round((27 + random() * 10) * u)
      const w = textWidth + padX * 2
      const placement = random()
      let x, y
      if (placement < 0.6) { x = cursor.x + Math.round(11 * u); y = cursor.y + Math.round((-34 + random() * 50) * u) }
      else if (placement < 0.72) { x = cursor.x - w - Math.round(11 * u); y = cursor.y + Math.round((-30 + random() * 40) * u) }
      else { x = target.x + Math.round(random() * 24 * u); y = target.y - h - Math.round(random() * 8 * u) }
      x = Math.max(2, Math.min(W - w - 2, x)); y = Math.max(2, Math.min(H - h - 2, y))
      const alpha = 0.8 + random() * 0.17
      ctx.fillStyle = `rgba(9,10,10,${alpha})`
      ctx.fillRect(x, y, w, h)
      const frame = Math.max(1, Math.round(u))
      ctx.fillStyle = grey(Math.round(92 + random() * 70))
      ctx.fillRect(x, y, w, frame); ctx.fillRect(x, y + h - frame, w, frame); ctx.fillRect(x, y, frame, h); ctx.fillRect(x + w - frame, y, frame, h)
      ctx.fillStyle = grey(Math.round(172 + random() * 50))
      ctx.textBaseline = 'middle'
      ctx.fillText(spec.text, x + padX, y + h / 2 + 0.5)
      tooltip = { x, y, width: w, height: h }
    }
    if (spec.cursor) drawCursor(ctx, cursor.x, cursor.y, u)
    return { cursor, tooltip }
  }

  function toBgra(imageData) {
    const data = new Uint8Array(imageData.data.buffer.slice(0))
    for (let index = 0; index < data.length; index += 4) { const red = data[index]; data[index] = data[index + 2]; data[index + 2] = red }
    return { width: imageData.width, height: imageData.height, data }
  }

  function bitmapUrl(bitmap) {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    const image = ctx.createImageData(bitmap.width, bitmap.height)
    for (let index = 0; index < bitmap.data.length; index += 4) {
      image.data[index] = bitmap.data[index + 2]; image.data[index + 1] = bitmap.data[index + 1]; image.data[index + 2] = bitmap.data[index]; image.data[index + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  }

  window.runCase = (spec) => {
    const canvas = window.sceneCanvas ??= document.createElement('canvas')
    canvas.width = spec.W; canvas.height = spec.H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const scene = drawScene(ctx, spec)
    const capture = window.TD.TOOLTIP_CAPTURE ?? { left: 520, right: 720, up: 240, down: 160 }
    const left = Math.max(0, Math.round(scene.cursor.x - capture.left * spec.u)), top = Math.max(0, Math.round(scene.cursor.y - capture.up * spec.u))
    const right = Math.min(spec.W, Math.round(scene.cursor.x + capture.right * spec.u)), bottom = Math.min(spec.H, Math.round(scene.cursor.y + capture.down * spec.u))
    const image = toBgra(ctx.getImageData(left, top, right - left, bottom - top))
    const started = performance.now()
    const rect = window.TD.findTooltip(image, { x: scene.cursor.x - left, y: scene.cursor.y - top }, spec.u)
    const detectMs = performance.now() - started
    const result = { detectMs, tooltip: scene.tooltip, cursor: scene.cursor, rect: rect ? { ...rect, x: rect.x + left, y: rect.y + top } : null, variants: [] }
    if (rect) {
      const variants = window.TD.ocrVariants ? window.TD.ocrVariants(image, rect, { x: scene.cursor.x - left, y: scene.cursor.y - top }, spec.u) : [[3, 45, 150], [4, 30, 170], [3, 70, 120]].map(([scale, black, span]) => window.TD.tooltipForOcr(image, rect, scale, black, span))
      result.variants = variants.map(bitmapUrl)
    }
    if (spec.saveScene) result.scene = canvas.toDataURL('image/png')
    if (spec.exportCrop && scene.tooltip) {
      // A small fixture for the regression test: the tooltip, the cursor and some inventory around them.
      const pad = Math.round(36 * spec.u), t = scene.tooltip
      const x = Math.max(left, Math.min(t.x, scene.cursor.x) - pad), y = Math.max(top, Math.min(t.y, scene.cursor.y) - pad)
      const w = Math.min(right, Math.max(t.x + t.width, scene.cursor.x + 20) + pad) - x, h = Math.min(bottom, Math.max(t.y + t.height, scene.cursor.y + 30) + pad) - y
      const part = document.createElement('canvas'); part.width = w; part.height = h
      part.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h)
      result.exportCrop = { png: part.toDataURL('image/png'), cursor: { x: scene.cursor.x - x, y: scene.cursor.y - y }, unit: spec.u }
    }
    if (!rect && scene.tooltip) {
      // What the detector missed: the tooltip with some surroundings (and the cursor).
      const pad = Math.round(40 * spec.u), t = scene.tooltip
      const x = Math.max(0, Math.min(t.x, scene.cursor.x) - pad), y = Math.max(0, Math.min(t.y, scene.cursor.y) - pad)
      const w = Math.min(spec.W, Math.max(t.x + t.width, scene.cursor.x + 20) + pad) - x, h = Math.min(spec.H, Math.max(t.y + t.height, scene.cursor.y + 30) + pad) - y
      const part = document.createElement('canvas'); part.width = w; part.height = h
      part.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h)
      result.missCrop = part.toDataURL('image/png')
      result.missAt = { cursor: { x: scene.cursor.x - x, y: scene.cursor.y - y }, tooltip: { ...t, x: t.x - x, y: t.y - y }, u: spec.u }
    }
    return result
  }
}

// ---------------------------------------------------------------- run
const catalog = (await loadCatalog()).filter((item) => item.name && item.nameEn)
const selected = catalog.filter((_, index) => index % sample === 0).slice(0, limit || undefined)
const detectModule = await import(pathToFileURL(join(srcDir, 'tooltipDetect.ts')).href)
const matchModule = await import(pathToFileURL(join(srcDir, baseline || !existsSync(join(srcDir, 'tooltipMatch.ts')) ? 'itemMatch.ts' : 'tooltipMatch.ts')).href)
const toItem = (entry, english) => ({ id: entry.id, name: english ? entry.nameEn : entry.name, shortName: english ? entry.shortNameEn : entry.shortName, category: 'Бартер', description: '', prices: [] })
let matchers
if (baseline) {
  // The old app: the catalog in one language (the app's), whole-name matcher with the fuzzy matcher as fallback.
  const make = (english) => {
    const items = catalog.map((entry) => toItem(entry, english))
    const tooltip = matchModule.createTooltipMatcher(items), fuzzy = matchModule.createItemMatcher(items)
    return (text) => tooltip(text) ?? fuzzy(text)
  }
  matchers = { ru: make(false), en: make(true) }
} else {
  const items = catalog.map((entry) => toItem(entry, false))
  const alternates = new Map(catalog.map((entry) => [entry.id, [{ name: entry.nameEn, shortName: entry.shortNameEn }]]))
  const match = matchModule.createTooltipMatcher(items, alternates)
  matchers = { ru: match, en: match }
}

// Which texts identify one item: a short name shared by several items (e.g. "PM") cannot, so the right answer is none.
const norm = (value) => value.toLowerCase().replace(/\s+/g, ' ').trim()
const owners = new Map()
for (const entry of catalog) for (const text of [entry.name, entry.shortName, entry.nameEn, entry.shortNameEn]) {
  if (!text) continue
  const key = norm(text)
  owners.set(key, (owners.get(key) ?? new Set()).add(entry.id))
}
const sameName = (a, b) => a && b && (norm(a.name) === norm(b.name) || norm(a.nameEn ?? '') === norm(b.nameEn ?? ''))
const byId = new Map(catalog.map((entry) => [entry.id, entry]))

const cases = []
let seed = 1
for (const [index, entry] of selected.entries()) {
  // Every item in both languages (one at 1080p, the other at 1440p, alternating) and its short name in one of
  // them; --dense: both languages at both resolutions and both short names.
  const hd = index % 2 === 0
  const variants = flag('dense')
    ? [{ lang: 'ru', short: false, u: 1 }, { lang: 'ru', short: false, u: 4 / 3 }, { lang: 'en', short: false, u: 1 }, { lang: 'en', short: false, u: 4 / 3 }, { lang: 'ru', short: true, u: hd ? 1 : 4 / 3 }, { lang: 'en', short: true, u: hd ? 4 / 3 : 1 }]
    : [{ lang: 'ru', short: false, u: hd ? 1 : 4 / 3 }, { lang: 'en', short: false, u: hd ? 4 / 3 : 1 }, { lang: index % 4 < 2 ? 'ru' : 'en', short: true, u: index % 3 ? 1 : 4 / 3 }]
  for (const variant of variants) {
    const text = variant.lang === 'ru' ? (variant.short ? entry.shortName : entry.name) : (variant.short ? entry.shortNameEn : entry.nameEn)
    const full = variant.lang === 'ru' ? entry.name : entry.nameEn
    if (!text || (variant.short && norm(text) === norm(full))) continue
    cases.push({ entry, ...variant, text, seed: seed++ })
  }
}
// A few scenes without any tooltip (the game has not shown it yet): nothing may be found there.
for (let index = 0; index < Math.max(20, Math.round(cases.length / 50)); index += 1) cases.push({ entry: selected[index % selected.length], lang: 'ru', text: '', short: false, u: index % 2 ? 1 : 4 / 3, seed: seed++, noTooltip: true })

await mkdir(join(outDir, 'failures'), { recursive: true })
if (exportDir) await mkdir(exportDir, { recursive: true })
const exported = []
const sharp = exportDir ? require('sharp') : null
const browser = await chromium.launch(existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {})
const fontFace = fontPath ? `@font-face { font-family: GameFont; src: url(data:font/${fontPath.split('.').pop()};base64,${(await readFile(fontPath)).toString('base64')}); }` : ''
const detector = await pageModule()
// Scenes are drawn (and the tooltip searched) in a few pages at once; the OCR workers read meanwhile.
const pages = await Promise.all(Array.from({ length: Number(option('pages', '2')) }, async () => {
  const page = await browser.newPage()
  await page.setContent(`<style>${fontFace}</style><body>${fontPath ? '<span style="font-family:GameFont">Аа Aa</span>' : ''}</body>`)
  if (fontPath) await page.evaluate(async () => { await document.fonts.load('13px GameFont', 'Аа'); await document.fonts.ready })
  await page.addScriptTag({ content: detector })
  await page.addScriptTag({ content: `(${inPage.toString()})()` })
  return page
}))
const font = fontPath ? 'GameFont' : '"Liberation Sans", Arial, sans-serif'
const labels = selected.map((entry) => entry.shortName).filter(Boolean).slice(0, 400)

const langPath = join(root, 'electron/tessdata')
const pool = await Promise.all(Array.from({ length: workers }, async () => {
  const worker = await createWorker('rus+eng', 1, { langPath, cachePath: langPath, gzip: false })
  // The app's own settings when the sources have them (see TOOLTIP_OCR_PARAMETERS).
  await worker.setParameters(detectModule.TOOLTIP_OCR_PARAMETERS ?? { tessedit_pageseg_mode: '7', user_defined_dpi: '300' })
  return worker
}))

const stats = { total: 0, correct: 0, wrong: 0, missed: 0, notDetected: 0, wrongBox: 0, falseTooltip: 0, noTooltipScenes: 0, ocrReads: 0, detectMs: 0 }
const groups = new Map()
const failures = []
const started = Date.now()

async function ocrCase(worker, item, rendered) {
  const tries = []
  for (const url of rendered.variants) {
    const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
    const text = ((await worker.recognize(png)).data.text ?? '').replace(/\s+/g, ' ').trim()
    stats.ocrReads += 1
    tries.push(text)
    if (!text) continue
    const found = matchers[item.lang](text)
    if (found) return { found, tries }
  }
  return { found: null, tries }
}

const queue = []
let rendering = 0
let nextCase = 0
async function renderAll(page) {
  for (;;) {
    const index = nextCase++
    if (index >= cases.length) return
    const item = cases[index]
    const spec = { W: Math.round(1920 * item.u), H: Math.round(1080 * item.u), u: item.u, font, seed: item.seed, text: item.text, noTooltip: item.noTooltip, cursor: item.seed % 5 !== 0, item: { width: item.entry.width ?? 1, height: item.entry.height ?? 1, bg: item.entry.bg ?? 'default' }, shortLabel: item.entry.shortName, labels, saveScene: index < saveScenes, exportCrop: Boolean(exportDir) }
    const rendered = await page.evaluate((next) => window.runCase(next), spec)
    if (rendered.exportCrop) {
      const name = `${String(index).padStart(3, '0')}-${item.lang}${item.short ? '-short' : ''}-${item.u === 1 ? 1080 : 1440}`
      await sharp(Buffer.from(rendered.exportCrop.png.split(',')[1], 'base64')).png({ palette: true, colors: 96, effort: 10 }).toFile(join(exportDir, `${name}.png`))
      exported.push({ file: `${name}.png`, id: item.entry.id, text: item.text, lang: item.lang, short: item.short, cursor: rendered.exportCrop.cursor, unit: rendered.exportCrop.unit })
    }
    if (rendered.scene) await writeFile(join(outDir, `scene-${index}.png`), Buffer.from(rendered.scene.split(',')[1], 'base64'))
    queue.push({ item, rendered })
    rendering += 1
    while (queue.length > workers * 4) await new Promise((next) => setTimeout(next, 5))
  }
}

function overlaps(a, b) {
  if (!a || !b) return false
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return x * y >= 0.5 * Math.min(a.width * a.height, b.width * b.height)
}

let done = 0
async function consume(worker) {
  for (;;) {
    const job = queue.shift()
    if (!job) { if (rendering >= cases.length) return; await new Promise((next) => setTimeout(next, 5)); continue }
    const { item, rendered } = job
    stats.detectMs += rendered.detectMs
    if (item.noTooltip) {
      stats.noTooltipScenes += 1
      if (rendered.rect) stats.falseTooltip += 1
      done += 1
      continue
    }
    stats.total += 1
    const key = `${item.lang}${item.short ? '-short' : ''}@${item.u === 1 ? 1080 : 1440}`
    const size = (item.entry.width ?? 1) * (item.entry.height ?? 1) >= 4 ? 'big' : 'small'
    for (const group of [key, `size-${size}`, 'all']) { const g = groups.get(group) ?? { total: 0, correct: 0, wrong: 0, missed: 0 }; g.total += 1; groups.set(group, g) }
    const owner = owners.get(norm(item.text))
    const expectNone = item.short && owner && owner.size > 1
    let verdict, tries = [], found = null
    if (!rendered.rect) { stats.notDetected += 1; verdict = expectNone ? 'correct' : 'missed' }
    else if (detectOnly) verdict = overlaps(rendered.rect, rendered.tooltip) ? 'correct' : 'wrong'
    else {
      if (!overlaps(rendered.rect, rendered.tooltip)) stats.wrongBox += 1
      ;({ found, tries } = await ocrCase(worker, item, rendered))
      if (expectNone) verdict = found ? (owner.has(found.id) ? 'correct' : 'wrong') : 'correct'
      else verdict = !found ? 'missed' : found.id === item.entry.id || sameName(byId.get(found.id), item.entry) ? 'correct' : 'wrong'
    }
    stats[verdict] += 1
    for (const group of [key, `size-${size}`, 'all']) groups.get(group)[verdict] += 1
    if (verdict !== 'correct') {
      failures.push({ verdict, lang: item.lang, short: item.short, scale: item.u === 1 ? 1080 : 1440, text: item.text, id: item.entry.id, size: `${item.entry.width}x${item.entry.height}`, detected: Boolean(rendered.rect), rightBox: overlaps(rendered.rect, rendered.tooltip), read: tries, got: found ? found.name : null, missAt: rendered.missAt, file: failures.length + 1 })
      if (failures.length <= 150 && rendered.missCrop) await writeFile(join(outDir, 'failures', `${failures.length}-notfound.png`), Buffer.from(rendered.missCrop.split(',')[1], 'base64'))
      if (failures.length <= 150 && rendered.variants[0]) await writeFile(join(outDir, 'failures', `${failures.length}-${verdict}.png`), Buffer.from(rendered.variants[0].split(',')[1], 'base64'))
    }
    done += 1
    if (done % 200 === 0) process.stdout.write(`\r${done}/${cases.length}  correct ${stats.correct}/${stats.total}  wrong ${stats.wrong}  ${Math.round((Date.now() - started) / 1000)}s   `)
  }
}

await Promise.all([...pages.map(renderAll), ...pool.map(consume)])
await Promise.all(pool.map((worker) => worker.terminate()))
await browser.close()

const percent = (value, total) => `${(100 * value / Math.max(1, total)).toFixed(1)}%`
const report = {
  source: srcDir, baseline, font: fontPath || 'system sans', items: selected.length, cases: stats.total,
  correct: `${stats.correct} (${percent(stats.correct, stats.total)})`, wrong: `${stats.wrong} (${percent(stats.wrong, stats.total)})`, missed: `${stats.missed} (${percent(stats.missed, stats.total)})`,
  tooltipNotFound: stats.notDetected, wrongBoxRead: stats.wrongBox, tooltipInEmptyScenes: `${stats.falseTooltip}/${stats.noTooltipScenes}`,
  avgDetectMs: +(stats.detectMs / Math.max(1, stats.total + stats.noTooltipScenes)).toFixed(1), ocrReadsPerCase: +(stats.ocrReads / Math.max(1, stats.total)).toFixed(2), seconds: Math.round((Date.now() - started) / 1000),
  groups: Object.fromEntries([...groups.entries()].sort().map(([key, group]) => [key, `${group.correct}/${group.total} correct (${percent(group.correct, group.total)}), ${group.wrong} wrong, ${group.missed} missed`])),
}
if (exportDir) await writeFile(join(exportDir, 'cases.json'), `${JSON.stringify(exported, null, 1)}\n`, 'utf8')
await writeFile(join(outDir, 'report.json'), JSON.stringify({ report, failures }, null, 2), 'utf8')
console.log(`\n${JSON.stringify(report, null, 2)}\nFailures: ${join(outDir, 'report.json')}`)
