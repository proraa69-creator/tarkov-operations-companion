// Renders the drawn game backdrop once to a PNG (blur filters are too slow to paint every frame while recording).
import { chromium } from '../../env.mjs'
import { S } from '../rec.mjs'
import { stageScript, installStage } from './stage.mjs'
const lang = process.argv[2] ?? 'ru'
const { T } = await import('../texts.mjs')
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--force-color-profile=srgb'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
await page.setContent('<!doctype html><html class="overlay-root"><body style="margin:0"></body></html>')
await page.evaluate(installStage, stageScript({ note: T[lang].minimapNote, scale: 1 }))
await page.addStyleTag({ content: '#game .layer, #game .strip { animation: none !important }' })
await page.waitForTimeout(300)
await page.screenshot({ path: `${S}/promo/rec/minimap/backdrop-${lang}.png` })
await browser.close()
console.log('backdrop', lang)
