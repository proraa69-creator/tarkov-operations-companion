import { expect, test, type Page } from '@playwright/test'

// The built page at phone size, with no server: the intro, then the account screen under it. Everything else in the e2e
// tests runs with no intro at all: a browser under automation does not get one (public/startup-intro.js).
const asAPlayer = (page: Page) => page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
const noServer = (page: Page) => page.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()))

test.use({ viewport: { width: 390, height: 844 } })

test('the intro stands over the start with no words, plays to its end and opens the screen under it', async ({ page }) => {
  await asAPlayer(page)
  await noServer(page)
  await page.goto('/', { waitUntil: 'commit' })
  const intro = page.locator('#startup-intro')
  await expect(intro).toBeVisible()
  await expect(intro).toHaveText('')
  await expect(page.locator('html')).toHaveAttribute('data-startup-intro', 'play')
  // Each moving part is an animation of its own, none of them waiting for the page's code.
  expect(await intro.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBeGreaterThan(50)
  await expect(intro).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('html')).not.toHaveAttribute('data-startup-intro', /.*/)
  await expect(page.locator('.paywall')).toBeVisible()
  await expect(page.getByText('Проверяем подписку')).toHaveCount(0)
})

test('a reload in the same window does not play it again', async ({ page }) => {
  await asAPlayer(page)
  await noServer(page)
  await page.goto('/', { waitUntil: 'commit' })
  await expect(page.locator('#startup-intro')).toBeVisible()
  await expect(page.locator('#startup-intro')).toHaveCount(0, { timeout: 10_000 })
  await page.reload({ waitUntil: 'commit' })
  await expect(page.locator('html')).toHaveAttribute('data-startup-intro', 'still')
  await expect(page.locator('#startup-intro')).toHaveCount(0, { timeout: 5_000 })
})

test('motion turned off: the finished logo, nothing travelling, the thread only brightening and dimming', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 }, baseURL: 'http://127.0.0.1:4173' })
  const page = await context.newPage()
  await asAPlayer(page)
  await noServer(page)
  await page.goto('/', { waitUntil: 'commit' })
  const intro = page.locator('#startup-intro')
  await expect(intro).toBeVisible()
  const names = await intro.evaluate((element) => [...new Set(element.getAnimations({ subtree: true }).map((animation) => (animation as CSSAnimation).animationName))])
  expect(names).toEqual(['si-breathe'])
  await expect(intro).toHaveCount(0, { timeout: 5_000 })
  await context.close()
})

test('a browser under automation gets no intro', async ({ page }) => {
  await noServer(page)
  await page.goto('/')
  await expect(page.locator('html')).not.toHaveAttribute('data-startup-intro', /.*/)
  await expect(page.locator('#startup-intro')).toBeHidden()
})
