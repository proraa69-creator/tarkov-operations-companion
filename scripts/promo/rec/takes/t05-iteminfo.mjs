// Scene 8: item info in the raid. The app's real item card (#/overlay/item, payloads sent through a stand-in desktop
// bridge) over a frame of the owner's stash clip, the game's own name tooltip, the item key, and a camera that moves
// in so the card reads on a phone. Prices are tarkov.dev PvE values (the clip is PvE); the friend's nickname is made up.
import { readFileSync } from 'node:fs'
import { beginTake } from '../take.mjs'
import { S } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const L = lang === 'en'
  ? { book: 'Battered antique book', cable: 'Military cable', therapist: 'Therapist' }
  : { book: 'Потрепанная антикварная книга', cable: 'Военный кабель', therapist: 'Терапевт' }
const BRIDGE = `(() => {
  const l = {}
  window.tarkovDesktop = { overlaySetInteractive() {}, overlayResize() {}, overlayDrag() {}, experimental: { updateSettings: async () => ({}) }, onOverlay(c, cb) { l[c] = cb; return () => {} } }
  window.__emit = (c, x) => l[c] && l[c](x)
})()`
const BG = `data:image/jpeg;base64,${readFileSync(`${S}/promo/rec/item/stash-bg.jpg`).toString('base64')}`
// Game pixels: the stash frame scaled to 1920×1080 (one stash cell is 63 px, as in a 1080p game). The camera shows
// the region from (X0, Y0) at ZOOM.
const ZOOM = 1.9, X0 = 900, Y0 = 250
const screen = ([x, y]) => ({ x: (x - X0) * ZOOM, y: (y - Y0) * ZOOM })
const BOOK = [1677, 586], CABLE = [1647, 487]
const book = { state: 'found', itemId: '5bc9c049d4351e44f824d360', name: L.book, shortName: 'Книга', iconUrl: 'https://assets.tarkov.dev/5bc9c049d4351e44f824d360-icon.webp', fleaPrice: 30000, bestTrader: { name: L.therapist, price: 32144 }, quests: [], kappa: true, collector: true }
const cable = { state: 'found', itemId: '5d0375ff86f774186372f685', name: L.cable, shortName: 'ВКабель', iconUrl: 'https://assets.tarkov.dev/5d0375ff86f774186372f685-icon.webp', fleaPrice: 74100, bestTrader: { name: L.therapist, price: 21012 }, quests: [], kappa: false, collector: false, mate: true, mateNames: ['Wolfhound'] }

const { page, rec, at, v, scenes, tx, finish } = await beginTake('t05-iteminfo', {
  lang, hash: '#/overlay/item', mouse: { x: 640, y: 860 }, extraInit: [BRIDGE],
  prepare: async (page) => {
    await page.evaluate(async ({ bg, icons }) => {
      const style = document.createElement('style')
      style.textContent = `
        html.overlay-root, html.overlay-root body { background: #000 !important }
        #stage { position: fixed; inset: 0; overflow: hidden; background: #000 }
        #cam { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; transform-origin: 0 0; transition: transform 1.5s cubic-bezier(.77,0,.175,1) }
        #cam > img { position: absolute; left: 0; top: 0; width: 1920px; height: 1080px; display: block }
        .game-tip { position: absolute; left: 0; top: 0; padding: 3px 8px 4px; background: rgb(4 4 4 / 94%); border: 1px solid #a3a39d; color: #ededE6;
          font: 500 13px/1.2 Bahnschrift, "Segoe UI", Arial, sans-serif; letter-spacing: .02em; white-space: nowrap; opacity: 0; transition: opacity .12s ease-out }
        .game-tip.is-in { opacity: 1 }
        html.overlay-root #cam #root { position: absolute !important; left: 0; top: 0; width: auto; height: auto; overflow: visible; opacity: 0; transition: opacity .12s ease-out }
        html.overlay-root #cam #root.is-in { opacity: 1 }
      `
      document.head.append(style)
      const stage = document.createElement('div'); stage.id = 'stage'
      const cam = document.createElement('div'); cam.id = 'cam'
      const img = new Image(); img.src = bg; cam.append(img)
      const tip = document.createElement('div'); tip.className = 'game-tip'; cam.append(tip)
      stage.append(cam); document.body.prepend(stage)
      const root = document.getElementById('root'); cam.append(root)
      await img.decode()
      await Promise.all(icons.map((src) => new Promise((resolve) => { const i = new Image(); i.onload = i.onerror = resolve; i.src = src })))
      const view = { x0: 0, y0: 0, zoom: 1 }
      let anchor = null
      // The card where the app puts it (overlay/itemCardPlacement.ts): right of and below the cursor, flipped to the
      // left / above when it would leave the visible part of the screen.
      const place = () => {
        if (anchor) {
          const card = root.firstElementChild
          const w = card?.offsetWidth ?? 0, h = card?.offsetHeight ?? 0
          const right = view.x0 + 1920 / view.zoom - 6, bottom = view.y0 + 1080 / view.zoom - 6
          // Decided by the widest card (max-width 340): «Распознаю…» and the answer stay on the same side.
          let x = anchor.x + 16, y = anchor.y + 22
          if (x + 340 > right) x = anchor.x - w - 16
          if (y + h > bottom) y = anchor.y - h - 12
          root.style.left = `${x}px`; root.style.top = `${y}px`
        }
        requestAnimationFrame(place)
      }
      requestAnimationFrame(place)
      window.__item = {
        camera(zoom, x0, y0) { Object.assign(view, { zoom, x0, y0 }); cam.style.transform = `translate(${-x0 * zoom}px, ${-y0 * zoom}px) scale(${zoom})` },
        tip(text, x, y) {
          if (!text) { tip.classList.remove('is-in'); return }
          tip.textContent = text
          const w = tip.offsetWidth, right = view.x0 + 1920 / view.zoom - 6
          tip.style.left = `${x + 14 + w > right ? x - w - 14 : x + 14}px`; tip.style.top = `${y - 40}px`
          tip.classList.add('is-in')
        },
        card(x, y) { anchor = { x, y }; root.classList.add('is-in') },
        hideCard() { root.classList.remove('is-in') },
      }
    }, { bg: BG, icons: [book.iconUrl, cable.iconUrl] })
  },
})
const item = (method, ...args) => page.evaluate(([method, args]) => window.__item[method](...args), [method, args])
const emit = (payload) => page.evaluate((p) => window.__emit('overlay:item', p), payload)
const keyAt = { x: 150, y: 905 }
async function lookup(payload, at_) {
  // The key, the app reading the tooltip, then the card.
  await rec.overlay('keyDown'); await emit({ state: 'loading' }); await rec.vsleep(40); await item('card', ...at_)
  await rec.vsleep(70); await rec.overlay('keyUp')
  await rec.vsleep(300); await emit(payload)
}

// «Информация о предмете прямо в рейде.»
await at(v(8, 0.05)); await rec.card({ at: { x: 64, y: 64 }, ...tx.itemIntro, arrow: false })
await item('camera', ZOOM, X0, Y0)
await at(v(8, 0.4)); await rec.moveTo(screen(BOOK), { duration: 1300, arc: 0.08 })
// «Наводишь на предмет и сразу видишь, нужен ли он для Каппы.»
await at(v(8, 1.95)); await item('tip', L.book, ...BOOK)
await at(v(8, 2.1)); await rec.overlay('hideCard', 'main'); await rec.overlay('key', { label: lang === 'en' ? ';' : 'Ж', caption: tx.itemKey, ...keyAt })
await at(v(8, 2.4)); await lookup(book, BOOK)
await at(v(8, 3.0)); await rec.ring({ id: 'badge', target: '.eft-kappa', pad: 5, radius: 6 }); await rec.card({ target: '.eft-card', side: 'left', ...tx.itemKappa })
// «Если он нужен другу из отряда, будет написан его ник.»
await at(v(8, 5.35)); await rec.overlay('clearAll'); await item('hideCard'); await item('tip', null)
await at(v(8, 5.5)); await rec.moveTo(screen(CABLE), { duration: 620, arc: 0.1 })
await at(v(8, 6.3)); await item('tip', L.cable, ...CABLE)
await at(v(8, 6.55)); await lookup(cable, CABLE)
await at(v(8, 7.2)); await rec.ring({ id: 'badge', target: '.eft-mate', pad: 5, radius: 6 }); await rec.card({ target: '.eft-card', side: 'left', ...tx.itemMate })
// «И тут же актуальная цена на барахолке и лучшая у торговцев.»
await at(v(8, 8.6)); await rec.overlay('clearAll')
await at(v(8, 8.85)); await rec.ring({ id: 'prices', target: '.eft-prices', pad: 7, radius: 6 }); await rec.card({ target: '.eft-card', side: 'left', ...tx.itemPrice })
await at(v(8, 12.25)); await rec.overlay('clearAll'); await rec.overlay('keyHide')
console.log('t05 length', await finish())
