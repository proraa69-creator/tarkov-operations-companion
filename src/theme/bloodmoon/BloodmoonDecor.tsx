import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import './bloodmoon.css'

export const BLOODMOON_THEME_ID = 'bloodmoon'

const isActive = () => typeof document !== 'undefined' && document.documentElement.dataset.theme === BLOODMOON_THEME_ID
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}
/** True while `<html data-theme="bloodmoon">` is set; follows the attribute live. */
export function useBloodmoonActive() {
  return useSyncExternalStore(subscribe, isActive, () => false)
}

/**
 * «Кровавая луна» (owner, 31.10.2026: «паутину где нибудь на кнопках, когда наводишь курсор на кнопку, проползает по ней
 * паук по диагонали, это редко, не всегда. и добавь что то про зомби… заражённые чвк, куски плоти, кровь»): the infected
 * PMCs under the blood moon in the empty foot of the sidebar (only where it fits under the menu), and now and then a
 * spider crossing a button the pointer comes onto. Rendered only while the theme is on; no animation under
 * prefers-reduced-motion. The cobwebs and the blood on the top bar are CSS (styles/theme-bloodmoon.css).
 */
export function BloodmoonDecor() {
  const active = useBloodmoonActive()
  const fits = useSceneRoom(active)
  useSpider(active)
  if (!active || !fits) return null
  return createPortal(<InfectedScene />, document.body)
}

/** The scene's height against the window bottom; shown only below the last menu item. */
const SCENE_HEIGHT = 236

function useSceneRoom(active: boolean) {
  const [fits, setFits] = useState(false)
  useEffect(() => {
    if (!active) return
    const sidebar = document.querySelector<HTMLElement>('.sidebar')
    if (!sidebar) return
    const measure = () => {
      const lists = sidebar.querySelectorAll<HTMLElement>(':scope > .nav-list')
      const last = lists[lists.length - 1]
      setFits(Boolean(last) && last!.getBoundingClientRect().bottom + 8 <= window.innerHeight - SCENE_HEIGHT)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(sidebar)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [active])
  return fits
}

/** One in this many hovers sends a spider, never more often than SPIDER_REST_MS: rare, not always. */
const SPIDER_CHANCE = 0.16
const SPIDER_REST_MS = 25_000
const SPIDER_MS = 2_200

function useSpider(active: boolean) {
  useEffect(() => {
    if (!active || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let restUntil = 0
    const onOver = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.('.button, button.icon-button')
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return
      const now = Date.now()
      if (now < restUntil || Math.random() > SPIDER_CHANCE) return
      restUntil = now + SPIDER_REST_MS
      crawl(target.getBoundingClientRect())
    }
    document.addEventListener('pointerover', onOver)
    return () => document.removeEventListener('pointerover', onOver)
  }, [active])
}

/** A spider from the button's top left corner to its bottom right one, then gone. */
export function crawl(box: DOMRect) {
  const size = Math.max(14, Math.min(22, box.height * 0.6))
  const spider = document.createElement('div')
  spider.className = 'bm-spider'
  spider.setAttribute('aria-hidden', 'true')
  spider.innerHTML = SPIDER_SVG
  Object.assign(spider.style, { left: `${box.left - size / 2}px`, top: `${box.top - size / 2}px`, width: `${size}px`, height: `${size}px` })
  document.body.append(spider)
  const angle = Math.atan2(box.height, box.width) * 180 / Math.PI + 90
  const animation = spider.animate([
    { transform: `translate(0, 0) rotate(${angle}deg)`, opacity: 0 },
    { opacity: 1, offset: 0.08 },
    { opacity: 1, offset: 0.92 },
    { transform: `translate(${box.width}px, ${box.height}px) rotate(${angle}deg)`, opacity: 0 },
  ], { duration: SPIDER_MS, easing: 'linear' })
  const done = () => spider.remove()
  animation.onfinish = done
  animation.oncancel = done
}

const SPIDER_SVG = `<svg viewBox="0 0 24 24" width="100%" height="100%"><g class="bm-spider-legs" stroke="#120707" stroke-width="1.3" stroke-linecap="round" fill="none">
<path d="M10 9 L5 5 L3 1"/><path d="M14 9 L19 5 L21 1"/><path d="M9.5 11 L4 10 L1 7"/><path d="M14.5 11 L20 10 L23 7"/>
<path d="M9.5 13 L4 15 L1 19"/><path d="M14.5 13 L20 15 L23 19"/><path d="M10 15 L6 19 L5 23"/><path d="M14 15 L18 19 L19 23"/></g>
<ellipse cx="12" cy="9" rx="2.4" ry="2.2" fill="#160808"/><ellipse cx="12" cy="14.5" rx="3.6" ry="4.4" fill="#1d0a0a"/>
<path d="M11 13 L13 13 L12 15.5 Z" fill="#c4141f"/><circle cx="11.2" cy="8" r=".55" fill="#ff5a3c"/><circle cx="12.8" cy="8" r=".55" fill="#ff5a3c"/></svg>`

/** The infected PMCs under the blood moon: blood pools, flesh, a quarantine tape. */
function InfectedScene() {
  return <div className="bm-scene" aria-hidden="true">
    <svg viewBox="0 0 240 236" width="240" height="236">
      <defs>
        <radialGradient id="bm-moon" cx="45%" cy="40%" r="60%">
          <stop offset="0" stopColor="#ff6a45" /><stop offset=".55" stopColor="#c41a1f" /><stop offset="1" stopColor="#5a080d" />
        </radialGradient>
        <radialGradient id="bm-glow" r="50%"><stop offset="0" stopColor="rgb(196 20 31 / 45%)" /><stop offset="1" stopColor="rgb(196 20 31 / 0%)" /></radialGradient>
        <linearGradient id="bm-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1a0b0b" /><stop offset="1" stopColor="#070404" /></linearGradient>
      </defs>
      {/* the moon */}
      <circle cx="168" cy="58" r="62" fill="url(#bm-glow)" />
      <circle cx="168" cy="58" r="34" fill="url(#bm-moon)" />
      <circle cx="158" cy="50" r="6" fill="#8e0b14" opacity=".5" /><circle cx="178" cy="66" r="4" fill="#8e0b14" opacity=".45" /><circle cx="172" cy="44" r="2.6" fill="#8e0b14" opacity=".5" />
      {/* ground */}
      <path d="M0 186 C40 176 80 182 120 178 C160 174 200 182 240 176 V236 H0 Z" fill="url(#bm-ground)" />
      {/* infected PMC in the back: hunched, arms forward */}
      <g fill="#060303" stroke="#5c0a10" strokeWidth=".8" transform="translate(132 104) scale(.78)">
        <path d="M14 8 Q27 -6 40 8 L42 12 H12 Z" />
        <ellipse cx="27" cy="18" rx="9" ry="10" />
        <path d="M14 28 Q27 22 42 30 L46 76 H12 Z" />
        <path d="M40 34 L72 44 L74 50 L40 42 Z" /><path d="M36 44 L70 60 L70 66 L35 52 Z" />
        <path d="M72 44 l6 -3 M74 48 l7 0 M70 62 l6 1 M70 66 l5 3" stroke="#060303" strokeWidth="1.6" />
        <path d="M16 76 L10 118 H19 L25 80 Z" /><path d="M32 76 L44 116 H53 L40 76 Z" />
        <circle cx="31" cy="17" r="1.3" fill="#9cff3a" stroke="none" /><circle cx="24" cy="17" r="1.3" fill="#9cff3a" stroke="none" />
      </g>
      {/* infected PMC in front: lurching towards the menu */}
      <g fill="#050202" stroke="#7a1d24" strokeWidth=".9" transform="translate(44 92)">
        <path d="M16 10 Q30 -6 46 10 L48 15 H14 Z" />
        <path d="M44 9 h8 v4 h-8z" fill="#1e1212" />
        <ellipse cx="31" cy="22" rx="10" ry="11" />
        <path d="M14 34 Q31 26 48 36 L54 92 H10 Z" />
        <path d="M18 44 h30 v14 h-30z" fill="#140808" />
        <path d="M46 40 L84 50 L86 57 L46 49 Z" /><path d="M42 52 L82 70 L81 77 L41 61 Z" />
        <path d="M84 50 l7 -4 M86 55 l8 0 M81 72 l7 1 M81 76 l6 4" stroke="#050202" strokeWidth="1.8" />
        <path d="M16 92 L8 140 H19 L27 96 Z" /><path d="M36 92 L52 138 H63 L46 92 Z" />
        <circle cx="35" cy="21" r="1.5" fill="#ff3b2f" stroke="none" /><circle cx="27" cy="21" r="1.5" fill="#ff3b2f" stroke="none" />
        <path d="M30 30 q2 6 -1 12" stroke="#c4141f" strokeWidth="1.4" fill="none" />
      </g>
      {/* blood, flesh */}
      <ellipse cx="96" cy="206" rx="44" ry="7" fill="#5c0a10" opacity=".9" />
      <ellipse cx="190" cy="214" rx="26" ry="5" fill="#6b0a10" opacity=".85" />
      <circle cx="140" cy="200" r="3" fill="#8e0b14" /><circle cx="150" cy="196" r="1.8" fill="#8e0b14" /><circle cx="62" cy="198" r="2.2" fill="#8e0b14" /><circle cx="210" cy="198" r="2" fill="#8e0b14" />
      <path d="M118 204 q6 -6 12 -1 q4 5 -3 7 q-8 2 -9 -6z" fill="#a8424a" stroke="#4a0a0e" strokeWidth=".8" />
      <path d="M168 206 q5 -4 9 0 q2 4 -4 5 q-6 0 -5 -5z" fill="#b5535a" stroke="#4a0a0e" strokeWidth=".8" />
      <path d="M30 210 q4 -5 9 -2 q3 4 -3 6 q-6 1 -6 -4z" fill="#9c3a42" stroke="#4a0a0e" strokeWidth=".8" />
      {/* quarantine tape */}
      <g transform="translate(-8 214) rotate(-7)">
        <rect width="270" height="15" fill="#c9a12a" />
        <rect width="270" height="15" fill="url(#bm-ground)" opacity=".18" />
        <text x="6" y="11" fontFamily="Oswald, Bahnschrift, sans-serif" fontSize="9.5" fontWeight="700" letterSpacing="1.2" fill="#140b05">☣ ЗАРАЖЕНО · INFECTED · ☣ ЗАРАЖЕНО · INFECTED</text>
      </g>
    </svg>
  </div>
}
