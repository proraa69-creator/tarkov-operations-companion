import { useEffect, useRef } from 'react'
import { isAppActive, onAppActivityChange } from '../app/appActivity'
import { SMOKE_GREEN_HUE, useRaidSmokeEnabled, useRaidSmokeOptions, type RaidSmokeOptions } from '../app/raidSmokeSetting'
import { bossFiguresFor } from '../data/bossFigures'
import { useAppState } from '../state/AppState'
import puff1 from '../assets/smoke/puff-1.webp'
import puff2 from '../assets/smoke/puff-2.webp'
import puff3 from '../assets/smoke/puff-3.webp'
import puff4 from '../assets/smoke/puff-4.webp'
import glowUrl from '../assets/smoke/glow.webp'
import '../styles/raidSmoke.css'

/**
 * Green signal smoke behind the boss figures of the Overview raid card (decorative, like a smoke grenade in the game).
 * ~40 pre-baked puff sprites (src/assets/smoke, made by the smoke prototype's bake script) rise very slowly from
 * behind the middle of the figure group; every puff is a pure function of the loop time, so the loop is seamless.
 * Canvas at half resolution and ≤ 30 fps; it sleeps while the card is off-screen, the window is hidden or
 * unfocused (the game is in front), and draws one still frame for reduced motion. Setting «Дым за боссами»
 * (on/off, plume width, speed, colour).
 */
export function RaidSmoke({ mapId }: { mapId: string }) {
  const enabled = useRaidSmokeEnabled()
  const { raidMode } = useAppState()
  // The figures follow the game mode (Black Division only in Season), so the smoke does too; a new key re-measures them.
  if (!enabled || !bossFiguresFor(mapId, raidMode).length) return null
  return <SmokeLayer key={`${mapId}-${raidMode}`} />
}

const PERIOD = 72 // s — puff lives are PERIOD / 2 and PERIOD / 3 (36 s, 24 s): very slow
const FRAME_MS = 1000 / 30
const SCALE = 0.5 // backing store: half the CSS pixels (the smoke is soft anyway)
// Enough overlapping puffs that the column reads as one continuous plume, not a stack of separate balls.
const PUFFS = 64
const STILL_TIME = PERIOD * 0.4

interface Puff { ground: boolean; life: number; off: number; sprite: number; rot: number; spin: number; jx: number; sway: number; dir: number; size: number; alpha: number }

function makePuffs(): Puff[] {
  let seed = 7
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  // Puffs of one life length are spread evenly over the loop (a little jitter only): random offsets left gaps in the
  // column, so the smoke came out in pieces.
  const groups = new Map<string, number>()
  const kinds = Array.from({ length: PUFFS }, (_, index) => {
    const ground = index % 4 === 3
    const k = ground ? 2 : 2 + (index % 2)
    const key = `${ground}-${k}`
    const slot = groups.get(key) ?? 0
    groups.set(key, slot + 1)
    return { ground, k, key, slot }
  })
  return kinds.map(({ ground, k, key, slot }, index) => {
    const count = groups.get(key)!
    const off = (slot + rnd() * 0.35) / count
    return { ground, life: PERIOD / k, off, sprite: index % 4, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 1.6, jx: rnd() - 0.5, sway: rnd() * 6.28, dir: rnd() < 0.5 ? -1 : 1, size: 0.8 + rnd() * 0.5, alpha: 0.65 + rnd() * 0.25 }
  })
}

/**
 * The baked puffs are dense discs with a fairly hard rim; a radial alpha falloff turns each into a soft cloud whose
 * edge melts into its neighbours, so overlapping puffs blend into one plume.
 */
function soften(sprite: Sprite): Sprite {
  const canvas = document.createElement('canvas')
  const w = sprite instanceof HTMLImageElement ? sprite.naturalWidth : sprite.width
  const h = sprite instanceof HTMLImageElement ? sprite.naturalHeight : sprite.height
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return sprite
  ctx.drawImage(sprite, 0, 0)
  const r = Math.min(w, h) / 2
  const falloff = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r)
  falloff.addColorStop(0, 'rgba(0,0,0,1)')
  falloff.addColorStop(0.35, 'rgba(0,0,0,0.85)')
  falloff.addColorStop(0.7, 'rgba(0,0,0,0.3)')
  falloff.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = falloff
  ctx.fillRect(0, 0, w, h)
  return canvas
}

function loadImage(url: string) {
  const image = new Image()
  image.src = url
  return image.decode().then(() => image)
}

type Sprite = HTMLImageElement | HTMLCanvasElement

/**
 * The baked sprites are green; another colour keeps each pixel's saturation and lightness and swaps the hue. Tone
 * moves the lightness toward black (−1) or white (+1), keeping the shading.
 */
function tint(image: HTMLImageElement, hue: number, tone: number): Sprite {
  if (hue === SMOKE_GREEN_HUE && !tone) return image
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return image
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = pixels.data, h = hue / 360
  const channel = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue
    const r = data[i]! / 255, g = data[i + 1]! / 255, b = data[i + 2]! / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b), base = (max + min) / 2, d = max - min
    if (!d) continue
    const l = tone > 0 ? base + (1 - base) * tone * 0.7 : base * (1 + tone * 0.7)
    const sat = Math.min(1, d / (1 - Math.abs(2 * base - 1)))
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q
    data[i] = Math.round(channel(p, q, h + 1 / 3) * 255)
    data[i + 1] = Math.round(channel(p, q, h) * 255)
    data[i + 2] = Math.round(channel(p, q, h - 1 / 3) * 255)
  }
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

function SmokeLayer() {
  const layerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const options = useRaidSmokeOptions()
  const optionsRef = useRef<RaidSmokeOptions>(options)
  const redrawRef = useRef<() => void>(() => {})
  useEffect(() => { optionsRef.current = options; redrawRef.current() }, [options])

  useEffect(() => {
    const layer = layerRef.current, canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!layer || !canvas || !ctx) return
    const puffs = makePuffs()
    let baked: HTMLImageElement[] = [], bakedGlow: HTMLImageElement | null = null, bakedKey = ''
    let sprites: Sprite[] = [], topSprites: Sprite[] = [], glow: Sprite | null = null
    let clearing: HTMLCanvasElement | null = null // soft hole behind the buttons, so they always stay clean
    let W = 0, H = 0, sourceX = 0, spread = 0
    let time = STILL_TIME, raf = 0, last = 0, onScreen = false, disposed = false
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')

    // canvas size and the smoke source: the middle of the figures, at their feet
    const measure = () => {
      const box = layer.getBoundingClientRect()
      W = Math.max(1, Math.round(box.width * SCALE)); H = Math.max(1, Math.round(box.height * SCALE))
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }
      const figures = [...(layer.parentElement?.querySelectorAll('.boss-figure') ?? [])].map((figure) => figure.getBoundingClientRect())
      if (figures.length) {
        const left = Math.min(...figures.map((rect) => rect.left)), right = Math.max(...figures.map((rect) => rect.right))
        sourceX = ((left + right) / 2 - box.left) * SCALE
        spread = Math.max(W * 0.3, (right - left) * SCALE)
      } else { sourceX = W * 0.6; spread = W * 0.8 }
      const buttons = [...(layer.parentElement?.querySelectorAll('.raid-actions .button') ?? [])].map((button) => button.getBoundingClientRect())
      clearing = null
      if (buttons.length) {
        const pad = 12
        const left = (Math.min(...buttons.map((rect) => rect.left)) - box.left - pad) * SCALE, right = (Math.max(...buttons.map((rect) => rect.right)) - box.left + pad) * SCALE
        const top = (Math.min(...buttons.map((rect) => rect.top)) - box.top - pad) * SCALE, bottom = (Math.max(...buttons.map((rect) => rect.bottom)) - box.top + pad) * SCALE
        if (right > 0) {
          clearing = document.createElement('canvas'); clearing.width = W; clearing.height = H
          const hole = clearing.getContext('2d')
          if (hole) { hole.filter = `blur(${Math.round(10 * SCALE)}px)`; hole.fillRect(left, top, right - left, bottom - top) }
        }
      }
    }

    const draw = (t: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, W, H)
      if (!sprites.length) return
      const wide = optionsRef.current.width
      const sx = sourceX, sy = H * 0.965
      const phase = (t / PERIOD) * Math.PI * 2
      const gust = Math.sin(phase) * 0.5 + Math.sin(phase * 2 + 1) * 0.25
      const list = puffs.map((puff) => {
        const u = (t / puff.life + puff.off) % 1
        let x, y, size, alpha
        if (puff.ground) { // low drift rolling outwards along the ground behind the legs
          x = sx + puff.dir * spread * 0.5 * wide * Math.pow(u, 0.7) + puff.jx * 20 * SCALE
          y = sy - H * 0.12 * Math.pow(u, 1.3) - 8 * SCALE
          size = W * (0.14 + 0.3 * Math.pow(u, 0.7)) * puff.size * wide
          alpha = Math.min(1, u / 0.12) * Math.pow(1 - u, 1.1) * 0.6
        } else { // the column: quick out of the can, then slows, widens and leans with the wind
          const rise = 1 - Math.pow(1 - u, 1.7)
          y = sy - H * 1.02 * rise
          x = sx + puff.jx * (6 + 55 * u) * (spread / (W * 0.8)) * wide - W * 0.14 * rise * rise * (1 + gust * 0.6) + Math.sin(u * 7 + puff.sway) * 10 * SCALE * u
          size = W * (0.09 + 0.36 * Math.pow(u, 0.75)) * puff.size * wide
          alpha = Math.min(1, u / 0.06) * Math.pow(1 - u, 0.9) * 1.5
        }
        return { puff, u, x, y, size, alpha }
      }).sort((a, b) => b.u - a.u)
      for (const item of list) {
        ctx.globalAlpha = Math.min(1, item.alpha * item.puff.alpha)
        ctx.setTransform(1, 0, 0, 1, item.x, item.y)
        if (item.puff.ground) ctx.scale(1.25, 0.6) // ground smoke lies flat
        ctx.rotate(item.puff.rot + item.puff.spin * item.u)
        if (topSprites.length) { // gradient: the colour shifts from the base hue to the top hue as the puff rises
          const mix = Math.min(1, Math.max(0, (item.u - 0.15) / 0.6))
          const alpha = ctx.globalAlpha
          if (mix < 1) { ctx.globalAlpha = alpha * (1 - mix); ctx.drawImage(sprites[item.puff.sprite]!, -item.size / 2, -item.size / 2, item.size, item.size) }
          if (mix > 0) { ctx.globalAlpha = alpha * mix; ctx.drawImage(topSprites[item.puff.sprite]!, -item.size / 2, -item.size / 2, item.size, item.size) }
        } else ctx.drawImage(sprites[item.puff.sprite]!, -item.size / 2, -item.size / 2, item.size, item.size)
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      if (glow) { // the burning can: a soft glow breathing every ~7 s
        const breath = 0.75 + 0.15 * Math.sin(phase * 10) + 0.1 * Math.sin(phase * 6 + 1)
        const g = W * 0.2
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 0.5 * breath
        ctx.drawImage(glow, sx - g / 2, sy - g * 0.7, g, g)
        ctx.globalCompositeOperation = 'source-over'
      }
      ctx.globalAlpha = 1
      if (clearing) {
        ctx.globalCompositeOperation = 'destination-out'
        ctx.drawImage(clearing, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
      }
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (last && now - last < FRAME_MS - 2) return
      const dt = last ? Math.min(now - last, 100) : 0
      last = now
      time = (time + dt / 1000 * optionsRef.current.speed) % PERIOD
      draw(time)
    }
    const stop = () => { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0 }
    const sync = () => {
      const run = !disposed && sprites.length > 0 && onScreen && isAppActive() && !reduced.matches
      if (run && !raf) raf = requestAnimationFrame(frame)
      else if (!run) { stop(); if (reduced.matches) draw(STILL_TIME) }
    }

    const colourKey = () => { const o = optionsRef.current; return `${o.hue}|${o.tone}|${o.gradient ? o.topHue : ''}` }
    const recolour = () => {
      const { hue, tone, gradient, topHue } = optionsRef.current
      bakedKey = colourKey()
      sprites = baked.map((image) => soften(tint(image, hue, tone)))
      topSprites = gradient && topHue !== hue ? baked.map((image) => soften(tint(image, topHue, tone))) : []
      glow = bakedGlow && tint(bakedGlow, hue, tone)
    }
    redrawRef.current = () => {
      if (!baked.length) return
      if (colourKey() !== bakedKey) recolour()
      if (!raf) draw(reduced.matches ? STILL_TIME : time)
    }
    const observer = new IntersectionObserver(([entry]) => { onScreen = !!entry?.isIntersecting; sync() })
    observer.observe(layer)
    const resize = new ResizeObserver(() => { measure(); if (!raf) draw(reduced.matches ? STILL_TIME : time) })
    resize.observe(layer)
    const actions = layer.parentElement?.querySelector('.raid-actions')
    if (actions) resize.observe(actions) // button widths change with the language
    const stopActivity = onAppActivityChange(sync)
    reduced.addEventListener('change', sync)

    Promise.all([Promise.all([puff1, puff2, puff3, puff4].map(loadImage)), loadImage(glowUrl)]).then(([puffImages, glowImage]) => {
      if (disposed) return
      baked = puffImages; bakedGlow = glowImage
      recolour()
      measure(); draw(time)
      layer.classList.add('is-ready')
      sync()
    }).catch(() => { /* decorative: no smoke if the sprites fail to load */ })

    return () => {
      disposed = true
      redrawRef.current = () => {}
      stop()
      observer.disconnect()
      resize.disconnect()
      stopActivity()
      reduced.removeEventListener('change', sync)
    }
  }, [])

  return <div className="raid-smoke" ref={layerRef} aria-hidden="true"><canvas ref={canvasRef} /></div>
}
