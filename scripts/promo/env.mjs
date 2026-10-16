// Where the promo tooling works. PROMO_WORK holds promo/ (this code, the owner's clips in promo/src, the voice clips in
// promo/voice/<lang>, the request cache in promo/netcache, takes and finished files in promo/out); RAIDOS_REPO is the app
// checkout whose node_modules (Playwright) and scripts/trailer (fonts, icon, music) are used. The app itself is recorded
// from a running Vite dev server (PROMO_BASE, see rec/rec.mjs).
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Defaults: the folder that holds this promo/ folder (scripts/ in the repo), and the repo that contains it.
const here = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
export const S = process.env.PROMO_WORK ?? here
export const REPO = process.env.RAIDOS_REPO ?? (existsSync(`${here}/../package.json`) ? fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '') : '/home/user/tarkov-operations-companion')
export const { chromium } = await import(`${REPO}/node_modules/playwright/index.mjs`)

/** The fonts and the icon a stage page loads from its own folder (copied from the site trailer's assets). */
export async function stageAssets(dir) {
  const { copyFileSync, existsSync } = await import('node:fs')
  const from = `${REPO}/scripts/trailer/assets`
  for (const name of ['inter-cyrillic.woff2', 'inter-latin.woff2', 'oswald-cyrillic.woff2', 'oswald-latin.woff2']) {
    if (!existsSync(`${dir}/${name}`)) copyFileSync(`${from}/fonts/${name}`, `${dir}/${name}`)
  }
  if (!existsSync(`${dir}/raidos-icon.svg`)) copyFileSync(`${from}/raidos-icon.svg`, `${dir}/raidos-icon.svg`)
}
