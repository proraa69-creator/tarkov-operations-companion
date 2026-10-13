// The app's own phone layout (the browser preview at phone width) for the «Скоро iOS и Android» scene: per section the
// scrolling content as one tall picture without the top bar and the tab bar, and those two bars on their own — the
// phones in the video scroll the content between the fixed bars, as the app does.
import { openApp, ready, close, S } from '../rec.mjs'
const lang = process.argv[2] ?? 'ru'
const { page } = await openApp({ locale: lang, hash: '#/', viewport: { width: 390, height: 844 } })
await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto' })
const shots = [['overview', '#/'], ['maps', '#/maps/customs'], ['kappa', '#/kappa-items'], ['quests', '#/quests']]
const out = (name) => `${S}/promo/rec/closing/phone-${lang}-${name}.png`
for (const [name, hash] of shots) {
  await page.evaluate((h) => { location.hash = h }, hash); await ready(page, 2200)
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300)
  await page.locator('.mobile-topbar').screenshot({ path: out(`${name}-top`) })
  await page.locator('.mobile-tabbar').screenshot({ path: out(`${name}-tabs`) })
  const bars = await page.evaluate(() => ({ top: document.querySelector('.mobile-topbar').getBoundingClientRect().height, tabs: document.querySelector('.mobile-tabbar').getBoundingClientRect().height }))
  // Only the first 3 screens: a phone shows a few seconds of scrolling.
  const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 844 * 3)
  await page.addStyleTag({ content: '.mobile-topbar, .mobile-tabbar { visibility: hidden !important }' })
  await page.screenshot({ path: out(name), clip: { x: 0, y: 0, width: 390, height }, fullPage: true })
  await page.evaluate(() => document.querySelectorAll('style').forEach((s) => { if (s.textContent.includes('visibility: hidden !important')) s.remove() }))
  console.log(name, height, JSON.stringify(bars))
}
await close()
