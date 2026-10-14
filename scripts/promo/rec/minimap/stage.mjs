// The game backdrop of the minimap scene (drawn, no game footage; the look of scripts/trailer's in-game backdrop) and
// the overlay window placed like the app places it: top-right corner, scaled up for the video.
export const MINIMAP_BRIDGE = `(() => {
  const l = {}
  window.tarkovDesktop = { overlaySetInteractive() {}, overlayResize() {}, overlayDrag() {}, overlayZones() {}, overlayHold() {},
    experimental: { updateSettings: async () => ({}), toggleMinimap: async () => true }, onOverlay(c, cb) { l[c] = cb; return () => {} } }
  window.__emit = (c, x) => l[c] && l[c](x)
})()`

export function stageScript({ note, scale }) {
  const letters = ['С', '', '', 'СВ', '', '', 'В', '', '', 'ЮВ', '', '', 'Ю', '', '', 'ЮЗ', '', '', 'З', '', '', 'СЗ', '', '']
  return { note, scale, letters }
}

/** Runs in the page: the backdrop under the app, the app's #root scaled at the top-right. */
export function installStage({ note, scale, letters }) {
  const style = document.createElement('style')
  style.textContent = `
    html.overlay-root, html.overlay-root body { background: #0b0e0c !important }
    #game { position: fixed; inset: 0; overflow: hidden; z-index: 0;
      background: radial-gradient(900px 560px at 80% 24%, rgb(196 204 186 / 34%), transparent 70%), radial-gradient(1200px 700px at 22% 18%, rgb(170 180 160 / 20%), transparent 65%), radial-gradient(900px 500px at 80% 85%, rgb(60 80 60 / 30%), transparent 70%),
        linear-gradient(180deg, #2a302b 0%, #1a1f1b 42%, #0f1310 43%, #141a15 70%, #0a0d0b 100%) }
    #game .layer { position: absolute; inset: -6%; animation: drift 14s ease-in-out infinite alternate }
    @keyframes drift { from { transform: translateX(-18px) scale(1.04) } to { transform: translateX(18px) scale(1.06) } }
    #game .haze { position: absolute; inset: -10%; filter: blur(40px); opacity: .7;
      background: radial-gradient(420px 180px at 30% 40%, rgb(200 205 190 / 18%), transparent 70%), radial-gradient(520px 220px at 70% 36%, rgb(180 190 170 / 14%), transparent 70%), radial-gradient(700px 260px at 50% 60%, rgb(0 0 0 / 35%), transparent 70%) }
    #game .ridge { position: absolute; left: -5%; right: -5%; top: 36%; height: 200px; opacity: .55; filter: blur(3px); background: linear-gradient(180deg, #151a16, #0d110e);
      clip-path: polygon(0 60%, 6% 48%, 12% 55%, 20% 38%, 27% 46%, 34% 30%, 41% 42%, 50% 34%, 58% 44%, 66% 28%, 74% 40%, 82% 33%, 90% 46%, 100% 38%, 100% 100%, 0 100%) }
    #game .grain { position: absolute; inset: 0; opacity: .16; mix-blend-mode: overlay;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='240' height='240' filter='url(%23n)'/></svg>") }
    #game .vignette { position: absolute; inset: 0; background: radial-gradient(1200px 760px at 50% 50%, transparent 40%, rgb(0 0 0 / 78%) 100%) }
    #game .hud { position: absolute; inset: 44px }
    #game .hud i { position: absolute; width: 60px; height: 60px; border-color: rgb(220 225 210 / 28%); border-style: solid }
    #game .hud i:nth-child(1) { left: 0; top: 0; border-width: 2px 0 0 2px } #game .hud i:nth-child(2) { right: 0; top: 0; border-width: 2px 2px 0 0 }
    #game .hud i:nth-child(3) { left: 0; bottom: 0; border-width: 0 0 2px 2px } #game .hud i:nth-child(4) { right: 0; bottom: 0; border-width: 0 2px 2px 0 }
    #game .note { position: absolute; left: 76px; bottom: 52px; font: 600 15px/1 Inter, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: rgb(220 225 210 / 45%) }
    #game .compass { position: absolute; left: 50%; top: 26px; width: 640px; margin-left: -320px; height: 36px; overflow: hidden; opacity: .55; mask-image: linear-gradient(90deg, transparent, #000 20%, #000 80%, transparent) }
    #game .strip { position: absolute; top: 0; left: -300px; height: 36px; width: 2400px; display: flex; animation: pan 14s ease-in-out infinite alternate }
    @keyframes pan { from { transform: translateX(0) } to { transform: translateX(-160px) } }
    #game .strip span { flex: 0 0 40px; border-left: 1px solid rgb(230 230 220 / 50%); height: 10px; position: relative }
    #game .strip span:nth-child(3n+1) { height: 16px }
    #game .strip em { position: absolute; top: 18px; left: -6px; font: 600 14px/1 Inter, sans-serif; font-style: normal; color: rgb(235 235 225 / 80%) }
    html.overlay-root #root { position: fixed !important; inset: 0; z-index: 1; padding: 30px 34px 0 0; box-sizing: border-box; background: transparent !important }
    html.overlay-root #root > * { transform: scale(${scale}); transform-origin: top right; opacity: 0; transition: opacity .18s ease-out }
    html.overlay-root #root.is-open > * { opacity: 1 }
  `
  document.head.append(style)
  const game = document.createElement('div')
  game.id = 'game'
  let strip = ''
  for (let i = 0; i < 60; i += 1) { const t = letters[i % letters.length]; strip += `<span>${t ? `<em>${t}</em>` : ''}</span>` }
  game.innerHTML = `<div class="layer"><div class="haze"></div><div class="ridge"></div></div><div class="grain"></div><div class="vignette"></div><div class="compass"><div class="strip">${strip}</div></div><div class="hud"><i></i><i></i><i></i><i></i></div><div class="note"></div>`
  game.querySelector('.note').textContent = note
  document.body.prepend(game)
}

/** Runs in the page: the pre-rendered backdrop (backdrop.mjs) under the app, the app's #root scaled at the top-right. */
export function installStaticStage({ bg, scale }) {
  const style = document.createElement('style')
  style.textContent = `
    html.overlay-root, html.overlay-root body { background: #0b0e0c url(${bg}) center / cover no-repeat !important }
    html.overlay-root #root { position: fixed !important; inset: 0; z-index: 1; padding: 30px 34px 0 0; box-sizing: border-box; background: transparent !important;
      transform: scale(${scale}); transform-origin: top right; opacity: 0; transition: opacity .18s ease-out }
    html.overlay-root #root.is-open { opacity: 1 }
  `
  document.head.append(style)
}
