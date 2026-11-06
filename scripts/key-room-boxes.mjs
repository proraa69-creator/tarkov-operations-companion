// Where each locked door's room lies on the schemes: writes src/data/keyRoomBoxes.json, { lockId: [x, z, w, h] } in game
// metres (the room's largest rectangle), used for the key's sign (src/data/mapRoomSigns.ts; owner, 06.11.2026: «короткие
// названия ключей… внутри каждой комнаты»). Customs and Shoreline draw locked rooms as their own shapes; on the other
// schemes the room is the smallest closed area of one colour beside the door. A door with neither stays out of the file
// and its sign stands at the door. Labs, the Labyrinth and Icebreaker have no scheme: see mapRoomSigns.ts.
//   node scripts/key-room-boxes.mjs
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
const sharp = require('sharp')

const MAPS_JSON = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'
const FEED = 'https://json.tarkov.dev/regular/maps'
/** Metres around the door that are looked at, and pixels per metre there. */
const WINDOW_M = 44
const PX_PER_M = 8
/** A locked shape further from its door than this is another room. */
const NEAR_M = 2.5
const ROOM_AREA_M2 = [3, 180]

const config = await fetch(MAPS_JSON).then((r) => r.json())
const feed = await fetch(FEED).then((r) => r.json())
const raw = feed.data?.maps ?? feed.data
const feedMaps = Array.isArray(raw) ? raw : Object.values(raw)

const inside = (x, z, [[x0, z0], [x1, z1]]) => x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && z >= Math.min(z0, z1) && z <= Math.max(z0, z1)

function floorGroups(map, { x, y, z }) {
  for (const layer of map.layers ?? []) {
    for (const extent of layer.extents ?? []) {
      const [low, high] = extent.height ?? [-Infinity, Infinity]
      if (y < low || y >= high) continue
      if (extent.bounds && !extent.bounds.some((bound) => inside(x, z, bound))) continue
      if (layer.svgLayer) return [layer.svgLayer]
    }
  }
  return ['Ground_Level', 'First_Floor']
}

function largestRectangle(mask, size) {
  const heights = new Int32Array(size)
  let area = 0
  let rect = null
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) heights[i] = mask[j * size + i] ? heights[i] + 1 : 0
    const stack = []
    for (let i = 0; i <= size; i++) {
      const h = i === size ? 0 : heights[i]
      let from = i
      while (stack.length && stack.at(-1)[1] >= h) {
        const [s, sh] = stack.pop()
        if (sh * (i - s) > area) { area = sh * (i - s); rect = [s, j - sh + 1, i, j + 1] }
        from = s
      }
      stack.push([from, h])
    }
  }
  return rect
}

function regionFrom(start, size, same) {
  const seen = new Uint8Array(size * size)
  const stack = [start]
  seen[start[1] * size + start[0]] = 1
  let count = 0
  let open = false
  while (stack.length) {
    const [i, j] = stack.pop()
    count += 1
    if (i === 0 || j === 0 || i === size - 1 || j === size - 1) open = true
    for (const [p, q] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (p < 0 || q < 0 || p >= size || q >= size || seen[q * size + p] || !same(p, q)) continue
      seen[q * size + p] = 1
      stack.push([p, q])
    }
  }
  return { seen, count, open }
}

const out = {}
const totals = {}
for (const group of config) {
  const map = (group.maps ?? []).find((entry) => entry.projection === 'interactive')
  const feedMap = feedMaps.find((entry) => entry.normalizedName === group.normalizedName)
  if (!map?.svgPath || !feedMap) continue
  const text = await fetch(map.svgPath).then((r) => r.text())
  const { document } = new JSDOM(text, { contentType: 'image/svg+xml' }).window
  const root = document.documentElement
  const [, , vw, vh] = root.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number)
  const bounds = map.svgBounds ?? map.bounds
  const angle = (map.coordinateRotation ?? 0) * Math.PI / 180
  const cos = Math.round(Math.cos(angle))
  const sin = Math.round(Math.sin(angle))
  // The frame the picture is stretched over: the bounds' corners as the map's projection turns them, y down.
  const frame = (x, z) => [x * cos - z * sin, -(x * sin + z * cos)]
  const [ax, ay] = frame(bounds[0][0], bounds[0][1])
  const [bx, by] = frame(bounds[1][0], bounds[1][1])
  const left = Math.min(ax, bx), right = Math.max(ax, bx), top = Math.min(ay, by), bottom = Math.max(ay, by)
  const toSvg = (x, z) => { const [fx, fy] = frame(x, z); return [(fx - left) / (right - left) * vw, (fy - top) / (bottom - top) * vh] }
  const toGame = (u, v) => {
    const fx = left + u / vw * (right - left)
    const fy = top + v / vh * (bottom - top)
    return [fx * cos + (-fy) * sin, -fx * sin + (-fy) * cos]
  }
  const unitsPerM = vw / (right - left)
  const windowUnits = WINDOW_M * unitsPerM
  const size = WINDOW_M * PX_PER_M

  // One text per floor and kind, so a door only renders it through another window.
  const texts = new Map()
  const render = async (groups, lockedOnly, u, v) => {
    const key = `${groups.join('+')}:${lockedOnly}`
    if (!texts.has(key)) {
      const copy = new JSDOM(text, { contentType: 'image/svg+xml' }).window.document
      const svg = copy.documentElement
      for (const child of [...svg.children]) if (child.tagName === 'g' && !groups.includes(child.id)) child.remove()
      for (const id of groups) copy.getElementById(id)?.setAttribute('style', 'display:inline')
      if (lockedOnly) {
        const kept = [...copy.querySelectorAll('g[id]')].filter((g) => /lock/i.test(g.id))
        if (!kept.length) { texts.set(key, null) } else {
          const walk = (node) => { for (const child of [...node.children]) { if (kept.includes(child) || child.tagName === 'style') continue; if (kept.some((g) => child.contains(g))) walk(child); else child.remove() } }
          walk(svg)
          const style = copy.createElementNS('http://www.w3.org/2000/svg', 'style')
          style.textContent = '*{fill:#fff!important;stroke:none!important;opacity:1!important;fill-opacity:1!important}'
          svg.appendChild(style)
        }
      }
      if (texts.get(key) !== null) {
        svg.setAttribute('viewBox', '@@VIEW@@')
        svg.setAttribute('width', String(size))
        svg.setAttribute('height', String(size))
        svg.removeAttribute('style')
        texts.set(key, new copy.defaultView.XMLSerializer().serializeToString(svg))
      }
    }
    const template = texts.get(key)
    if (!template) return null
    const view = `${u - windowUnits / 2} ${v - windowUnits / 2} ${windowUnits} ${windowUnits}`
    const { data, info } = await sharp(Buffer.from(template.replace('@@VIEW@@', view))).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return info.width === size && info.height === size ? data : null
  }

  const boxOf = (mask, u, v) => {
    const rect = largestRectangle(mask, size)
    if (!rect) return undefined
    const scale = windowUnits / size
    const [x0, z0] = toGame(u - windowUnits / 2 + rect[0] * scale, v - windowUnits / 2 + rect[1] * scale)
    const [x1, z1] = toGame(u - windowUnits / 2 + rect[2] * scale, v - windowUnits / 2 + rect[3] * scale)
    return [(x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0)].map((value) => Number(value.toFixed(1)))
  }

  let shapes = 0, walls = 0, none = 0
  for (const lock of feedMap.locks ?? []) {
    if (lock.lockType !== 'door') continue
    const [u, v] = toSvg(lock.position.x, lock.position.z)
    const groups = floorGroups(map, lock.position)
    const mid = size / 2

    // A locked room drawn as its own shape.
    const locked = await render(groups, true, u, v).catch(() => null)
    if (locked) {
      let start = null
      let best = Infinity
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        if (locked[(j * size + i) * 4 + 3] <= 128) continue
        const d = (i - mid) ** 2 + (j - mid) ** 2
        if (d < best) { best = d; start = [i, j] }
      }
      if (start && Math.sqrt(best) / PX_PER_M <= NEAR_M) {
        const { seen, count } = regionFrom(start, size, (p, q) => locked[(q * size + p) * 4 + 3] > 128)
        if (count / PX_PER_M ** 2 >= ROOM_AREA_M2[0]) {
          const box = boxOf(seen, u, v)
          if (box) { out[lock.id] = box; shapes += 1; continue }
        }
      }
    }

    // Else the smallest closed area of one colour beside the door.
    const picture = await render(groups, false, u, v).catch(() => null)
    let found = null
    if (picture) {
      const colour = (i, j) => { const at = (j * size + i) * 4; return [picture[at], picture[at + 1], picture[at + 2], picture[at + 3]] }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const sx = Math.round(mid + dx * 1.2 * PX_PER_M)
        const sz = Math.round(mid + dz * 1.2 * PX_PER_M)
        const base = colour(sx, sz)
        if (base[3] < 128) continue
        const { seen, count, open } = regionFrom([sx, sz], size, (p, q) => { const c = colour(p, q); return c[3] >= 128 && Math.abs(c[0] - base[0]) + Math.abs(c[1] - base[1]) + Math.abs(c[2] - base[2]) < 24 })
        const area = count / PX_PER_M ** 2
        if (open || area < ROOM_AREA_M2[0] || area > ROOM_AREA_M2[1]) continue
        if (!found || count < found.count) found = { seen, count }
      }
    }
    const box = found && boxOf(found.seen, u, v)
    if (box) { out[lock.id] = box; walls += 1 } else none += 1
  }
  totals[group.normalizedName] = { shapes, walls, none }
}
writeFileSync(new URL('../src/data/keyRoomBoxes.json', import.meta.url), `${JSON.stringify(out).replace(/\],/g, '],\n')}\n`)
console.log(totals, Object.keys(out).length)
