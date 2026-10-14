// Promo overlay drawn inside the app page: a cursor that follows the real mouse, a click ripple, guide-style tip cards
// (the look of src/onboarding/firstRunGuide.css, without the dimmed backdrop), a bouncing arrow, pulsing outlines and a
// key cap. Sizes are for a 1920×1080 video watched on a phone.
(() => {
  if (window.__promo) return
  const CSS = `
#pv-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:inherit;-webkit-font-smoothing:antialiased}
.pv-cursor{position:fixed;left:0;top:0;width:36px;height:36px;transform:translate(-200px,-200px);filter:drop-shadow(0 3px 7px rgb(0 0 0 / 60%));z-index:5}
.pv-cursor svg{width:36px;height:36px;display:block;transform-origin:5px 4px;transition:transform .09s cubic-bezier(.23,1,.32,1)}
.pv-cursor.is-down svg{transform:scale(.84)}
.pv-cursor.is-hidden{opacity:0}
.pv-ripple{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2.5px solid var(--brass-strong,#f1d98f);animation:pv-ripple .55s cubic-bezier(.23,1,.32,1) forwards;z-index:4}
@keyframes pv-ripple{from{opacity:.95;transform:scale(.35)}to{opacity:0;transform:scale(2.7)}}
.pv-ring{position:fixed;border-radius:12px;box-shadow:0 0 0 2.5px var(--brass,#c4a665),0 0 26px rgb(196 166 101 / 30%);opacity:0;transition:opacity .28s cubic-bezier(.23,1,.32,1);z-index:2}
.pv-ring.is-in{opacity:1}
.pv-ring.is-pulse{animation:pv-pulse 1.5s cubic-bezier(.23,1,.32,1) infinite}
@keyframes pv-pulse{0%{box-shadow:0 0 0 2.5px var(--brass,#c4a665),0 0 0 0 rgb(241 217 143 / 55%)}100%{box-shadow:0 0 0 2.5px var(--brass,#c4a665),0 0 0 16px rgb(241 217 143 / 0%)}}
.pv-card{position:fixed;left:0;top:0;width:460px;padding:20px 24px 22px;border:1px solid color-mix(in srgb,var(--brass,#c4a665) 45%,var(--line,#2a332c));border-radius:14px;
  background:radial-gradient(ellipse 90% 40% at 50% 0%,color-mix(in srgb,var(--brass,#c4a665) 12%,transparent),transparent 70%),linear-gradient(180deg,var(--panel-2,#18211b),var(--panel,#121915));
  box-shadow:inset 0 1px 0 rgb(255 255 255 / 6%),0 26px 64px rgb(0 0 0 / 62%);opacity:0;transform:translateY(12px) scale(.97);
  transition:opacity .28s cubic-bezier(.23,1,.32,1),transform .28s cubic-bezier(.23,1,.32,1);z-index:3}
.pv-card.is-in{opacity:1;transform:none}
.pv-card.is-out{opacity:0;transform:translateY(-6px) scale(.98);transition-duration:.2s}
.pv-eyebrow{display:flex;align-items:center;gap:8px;color:var(--brass,#c4a665);font-size:13.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
.pv-eyebrow svg{width:15px;height:15px}
.pv-card h3{margin:9px 0 8px;color:var(--text,#f1ead6);font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.01em}
.pv-card p{margin:0;color:var(--text-muted,#b9c2b5);font-size:18px;line-height:1.5}
.pv-arrow{position:fixed;left:0;top:0;width:36px;height:36px;margin:-18px 0 0 -18px;color:var(--brass-strong,#f1d98f);filter:drop-shadow(0 2px 6px rgb(0 0 0 / 70%));opacity:0;transition:opacity .25s ease-out;z-index:3}
.pv-arrow.is-in{opacity:1}
.pv-arrow svg{width:36px;height:36px;display:block;animation:pv-bounce 1.05s cubic-bezier(.77,0,.175,1) infinite alternate}
@keyframes pv-bounce{from{transform:translateY(0)}to{transform:translateY(-9px)}}
.pv-key{position:fixed;min-width:92px;height:92px;padding:0 22px;display:grid;place-items:center;border-radius:16px;font-weight:800;font-size:40px;line-height:1;color:#1a1d18;letter-spacing:.02em;
  background:linear-gradient(180deg,#f6f0dc,#d9cfb3);box-shadow:0 10px 0 #9d916f,0 18px 34px rgb(0 0 0 / 55%);transform:translateY(0) scale(.6);opacity:0;
  transition:transform .3s cubic-bezier(.23,1,.32,1),opacity .3s cubic-bezier(.23,1,.32,1),box-shadow .09s ease-out;z-index:6}
.pv-key.is-in{opacity:1;transform:translateY(0) scale(1)}
.pv-key.is-down{transform:translateY(9px) scale(1);box-shadow:0 1px 0 #9d916f,0 8px 18px rgb(0 0 0 / 45%);transition-duration:.08s}
.pv-key small{position:absolute;top:-34px;left:50%;transform:translateX(-50%);white-space:nowrap;font-weight:700;font-size:15px;line-height:1;letter-spacing:.12em;text-transform:uppercase;color:var(--brass-strong,#f1d98f);text-shadow:0 2px 6px rgb(0 0 0 / 80%)}
.pv-key-wave{position:fixed;border-radius:20px;border:3px solid var(--brass-strong,#f1d98f);animation:pv-wave .7s cubic-bezier(.23,1,.32,1) forwards;z-index:5}
@keyframes pv-wave{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(1.6)}}
`
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>'
  const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>'
  const POINTER = '<svg viewBox="0 0 28 28"><path d="M5 3.2 5.1 22.6 10 18.1 13.2 25.4 16.6 23.9 13.5 16.8 20.2 16.4Z" fill="#fbf8ef" stroke="#141812" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  let root, cursor
  const state = { x: -200, y: -200, cards: new Map(), rings: new Map(), arrows: new Map(), follow: new Set() }

  function mount() {
    if (root) return
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    root = document.createElement('div')
    root.id = 'pv-root'
    document.body.appendChild(root)
    cursor = el('div', 'pv-cursor')
    cursor.innerHTML = POINTER
    addEventListener('mousemove', (event) => move(event.clientX, event.clientY), true)
    addEventListener('mousedown', () => { cursor.classList.add('is-down'); ripple(state.x, state.y) }, true)
    addEventListener('mouseup', () => cursor.classList.remove('is-down'), true)
    requestAnimationFrame(track)
  }
  function el(tag, cls, parent = root) { const node = document.createElement(tag); node.className = cls; parent.appendChild(node); return node }
  function move(x, y) { state.x = x; state.y = y; cursor.style.transform = `translate(${x - 5}px, ${y - 4}px)` }
  function ripple(x, y) { const node = el('div', 'pv-ripple'); node.style.left = `${x}px`; node.style.top = `${y}px`; setTimeout(() => node.remove(), 900) }
  function rectOf(target) {
    if (!target) return null
    if (typeof target === 'object' && 'width' in target && !(target instanceof Element)) return target
    const node = typeof target === 'string' ? document.querySelector(target) : target
    if (!node) return null
    const r = node.getBoundingClientRect()
    return { left: r.left, top: r.top, width: r.width, height: r.height }
  }
  // Rings and arrows follow their targets (scrolling lists, panels that open).
  function track() {
    for (const [id, ring] of state.rings) {
      const r = rectOf(ring.target)
      if (!r) continue
      const pad = ring.pad
      Object.assign(ring.node.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`, borderRadius: `${ring.radius}px` })
    }
    requestAnimationFrame(track)
  }

  function card({ id = 'main', target, side = 'bottom', eyebrow = '', title = '', text = '', width = 460, at, arrow = true }) {
    hideCard(id, true)
    const node = el('div', 'pv-card')
    node.style.width = `${width}px`
    node.innerHTML = `${eyebrow ? `<div class="pv-eyebrow">${BULB}<span></span></div>` : ''}${title ? '<h3></h3>' : ''}${text ? '<p></p>' : ''}`
    if (eyebrow) node.querySelector('.pv-eyebrow span').textContent = eyebrow
    if (title) node.querySelector('h3').textContent = title
    if (text) node.querySelector('p').textContent = text
    const w = node.offsetWidth, h = node.offsetHeight
    const r = rectOf(target)
    const gap = 66, edge = 24, vw = innerWidth, vh = innerHeight
    let left, top, pointer = null
    if (at) { left = at.x; top = at.y }
    else if (!r) { left = (vw - w) / 2; top = (vh - h) / 2 }
    else {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      let s = side
      if (s === 'bottom' && r.top + r.height + gap + h + edge > vh) s = 'top'
      if (s === 'top' && r.top - gap - h < edge) s = 'bottom'
      if (s === 'right' && r.left + r.width + gap + w + edge > vw) s = 'left'
      if (s === 'left' && r.left - gap - w < edge) s = 'right'
      if (s === 'bottom') { left = cx - w / 2; top = r.top + r.height + gap; pointer = { x: cx, y: r.top + r.height + 33, turn: 0 } }
      if (s === 'top') { left = cx - w / 2; top = r.top - gap - h; pointer = { x: cx, y: r.top - 33, turn: 180 } }
      if (s === 'right') { left = r.left + r.width + gap; top = cy - h / 2; pointer = { x: r.left + r.width + 33, y: cy, turn: -90 } }
      if (s === 'left') { left = r.left - gap - w; top = cy - h / 2; pointer = { x: r.left - 33, y: cy, turn: 90 } }
    }
    left = Math.min(Math.max(edge, left), vw - w - edge)
    top = Math.min(Math.max(edge, top), vh - h - edge)
    node.style.left = `${left}px`
    node.style.top = `${top}px`
    let arrowNode = null
    if (pointer && arrow) {
      arrowNode = el('div', 'pv-arrow')
      arrowNode.innerHTML = ARROW
      arrowNode.style.left = `${pointer.x}px`
      arrowNode.style.top = `${pointer.y}px`
      arrowNode.style.transform = `rotate(${pointer.turn}deg)`
    }
    state.cards.set(id, { node, arrow: arrowNode })
    requestAnimationFrame(() => requestAnimationFrame(() => { node.classList.add('is-in'); arrowNode?.classList.add('is-in') }))
    return { left, top, width: w, height: h }
  }
  function hideCard(id = 'main', instant = false) {
    const entry = state.cards.get(id)
    if (!entry) return
    state.cards.delete(id)
    const nodes = [entry.node, entry.arrow].filter(Boolean)
    if (instant) { nodes.forEach((node) => node.remove()); return }
    entry.node.classList.remove('is-in')
    entry.node.classList.add('is-out')
    entry.arrow?.classList.remove('is-in')
    setTimeout(() => nodes.forEach((node) => node.remove()), 400)
  }
  function ring({ id = 'main', target, pad = 6, radius = 12, pulse = true }) {
    clearRing(id, true)
    const node = el('div', `pv-ring${pulse ? ' is-pulse' : ''}`)
    state.rings.set(id, { node, target, pad, radius })
    const r = rectOf(target)
    if (r) Object.assign(node.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`, borderRadius: `${radius}px` })
    requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add('is-in')))
  }
  function clearRing(id = 'main', instant = false) {
    const entry = state.rings.get(id)
    if (!entry) return
    state.rings.delete(id)
    if (instant) { entry.node.remove(); return }
    entry.node.classList.remove('is-in')
    setTimeout(() => entry.node.remove(), 350)
  }
  function clearAll() { for (const id of [...state.cards.keys()]) hideCard(id); for (const id of [...state.rings.keys()]) clearRing(id) }
  let keyNode = null
  function key({ label = 'F8', caption = '', x, y } = {}) {
    keyNode?.remove()
    keyNode = el('div', 'pv-key')
    keyNode.innerHTML = `${caption ? '<small></small>' : ''}<span></span>`
    if (caption) keyNode.querySelector('small').textContent = caption
    keyNode.querySelector('span').textContent = label
    keyNode.style.left = `${x}px`
    keyNode.style.top = `${y}px`
    requestAnimationFrame(() => requestAnimationFrame(() => keyNode.classList.add('is-in')))
  }
  function keyDown() {
    if (!keyNode) return
    keyNode.classList.add('is-down')
    const r = keyNode.getBoundingClientRect()
    const wave = el('div', 'pv-key-wave')
    Object.assign(wave.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    setTimeout(() => wave.remove(), 1000)
  }
  function keyUp() { keyNode?.classList.remove('is-down') }
  function keyHide() { if (!keyNode) return; const node = keyNode; keyNode = null; node.classList.remove('is-in'); setTimeout(() => node.remove(), 400) }
  function cursorVisible(visible) { cursor?.classList.toggle('is-hidden', !visible) }

  window.__promo = { mount, card, hideCard, ring, clearRing, clearAll, key, keyDown, keyUp, keyHide, cursorVisible, rectOf, where: () => ({ x: state.x, y: state.y }) }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)
})()
