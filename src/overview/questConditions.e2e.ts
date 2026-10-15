import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createLocalProfile } from '../domain/progress'

// «Условия квестов» end to end, offline: json.tarkov.dev answers from the fixture of real regular/* data
// (src/data/__fixtures__/tarkovDevConditionQuests.json). Pictures: QC_ASSET_DIR may hold tarkov.dev's real images
// (named by their path, «/» as «__»); without it every picture is a plain placeholder. QC_SCREENSHOT_DIR saves the shots.
const FEED = JSON.parse(readFileSync(new URL('../data/__fixtures__/tarkovDevConditionQuests.json', import.meta.url), 'utf8')) as Record<string, unknown>
const ASSETS = process.env.QC_ASSET_DIR
const SHOTS = process.env.QC_SCREENSHOT_DIR
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#26302a" stroke="#56645a"/><path d="M14 40 L50 24" stroke="#a9b6ac" stroke-width="6" stroke-linecap="round"/></svg>`

const PATRIOT = '64f5deac39e45b527a7c4232'
const ACTIVE = [PATRIOT, '65734c186dc1e402c80dc19e', '5bc4856986f77454c317bea7', '5c1234c286f77406fa13baeb', '60e729cf5698ee7b05057439']

async function openOverview(page: Page, locale: 'ru' | 'en', viewport: { width: number; height: number }) {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'json.tarkov.dev') return route.fulfill({ json: { data: FEED[url.pathname.split('/').pop() ?? ''] ?? {} } })
    if (url.hostname === 'assets.tarkov.dev') {
      const file = ASSETS ? join(ASSETS, url.pathname.slice(1).replace(/\//g, '__')) : ''
      if (file && existsSync(file)) return route.fulfill({ contentType: file.endsWith('.svg') ? 'image/svg+xml' : 'image/webp', body: readFileSync(file) })
      return route.fulfill({ contentType: 'image/svg+xml', body: PLACEHOLDER })
    }
    return route.abort()
  })
  const profile = createLocalProfile('Оператор', 'conditions-e2e')
  const now = '2026-10-15T08:00:00.000Z'
  const pvp = {
    ...profile.modes.pvp,
    playerLevel: 42,
    taskProgress: Object.fromEntries(ACTIVE.map((taskId) => [taskId, { taskId, status: 'active' as const, source: 'eft-log' as const, updatedAt: now }])),
  }
  await page.addInitScript(({ saved, lang }) => {
    if (sessionStorage.getItem('conditions-e2e')) return
    sessionStorage.setItem('conditions-e2e', '1')
    sessionStorage.setItem('tarkov-account-gate-skipped', '1')
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: saved.id, profiles: [saved] }))
    localStorage.setItem('tarkov-operations-ui-v2', JSON.stringify({ selectedMapId: 'streets-of-tarkov' }))
    localStorage.setItem('tarkov-operations-locale-v1', lang)
  }, { saved: { ...profile, modes: { ...profile.modes, pvp } }, lang: locale })
  await page.setViewportSize(viewport)
  await page.goto('/#/')
}

const shot = async (page: Page, name: string, target = page.locator('main')) => {
  if (SHOTS) await target.screenshot({ path: join(SHOTS, name) })
}

for (const locale of ['ru', 'en'] as const) {
  test(`«Условия квестов» on the Overview (${locale}): the card, the hover list and the build`, async ({ page }) => {
    test.setTimeout(120_000)
    await openOverview(page, locale, { width: 1600, height: 1100 })
    const card = page.locator('.quest-conditions-card')
    await expect(card).toBeVisible({ timeout: 45_000 })
    await expect(card.locator('.stat-label')).toHaveText(locale === 'en' ? 'Quest conditions' : 'Условия квестов')
    // the English catalog lends its names once loaded
    if (locale === 'en') await expect(page.locator('.current-tasks')).toContainText('Job for a Patriot', { timeout: 45_000 })
    await page.waitForLoadState('networkidle')
    // the card keeps the stats row's height: as tall as «Текущие задания» beside it
    await expect.poll(async () => {
      const [cardBox, tasksBox] = await Promise.all([card.boundingBox(), page.locator('[data-block="stat-tasks"] .stat-card').boundingBox()])
      return cardBox && tasksBox ? Math.abs(cardBox.height - tasksBox.height) : Infinity
    }).toBeLessThan(2)
    await page.waitForTimeout(400)
    await shot(page, `conditions-card-desktop-${locale}.png`, page.locator('.stat-grid'))

    // hover: every quest of Streets with gear conditions, over the grid below
    await card.hover()
    const list = card.locator('.qc-list')
    await expect(list).toHaveClass(/is-open/)
    // «Работа для патриота», «Стиляги» (Streets) and «Тарковский стрелок. Часть 6» (any map); «Подстава» (Customs) and «Ловкач» (Woods) not
    await expect(list.locator('.qc-row')).toHaveCount(3)
    const patriotName = locale === 'en' ? 'Job for a Patriot' : 'Работа для патриота'
    await list.locator('.qc-row', { hasText: patriotName }).hover()
    await expect(card.locator('.qc-main .qc-name')).toHaveText(patriotName)
    await page.waitForTimeout(400)
    await shot(page, `conditions-hover-list-${locale}.png`, page.locator('main'))

    // click: the build
    await card.locator('.qc-main').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.qc-weapon-card')).toContainText(locale === 'en' ? 'AK-12' : 'АК-12')
    await expect(dialog).toContainText(locale === 'en' ? 'PS-320' : 'ПС-320')
    await page.waitForTimeout(600)
    await shot(page, `conditions-details-${locale}.png`, page.locator('.quest-conditions-dialog'))
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)

    // «Тарковский стрелок. Часть 6»: any of the bolt-action rifles, any one of thirty suppressors
    await card.hover()
    const shooterName = locale === 'en' ? 'The Tarkov Shooter - Part 6' : 'Тарковский стрелок. Часть 6'
    await list.locator('.qc-row', { hasText: shooterName }).hover()
    await expect(card.locator('.qc-main .qc-name')).toHaveText(shooterName)
    await card.locator('.qc-main').click()
    await expect(dialog.locator('.qc-weapon-card')).toHaveCount(10)
    await expect(dialog.locator('.qc-block', { hasText: locale === 'en' ? 'Weapon parts' : 'Модули на оружии' }).locator('.gs-part')).toHaveCount(30)
    await page.waitForTimeout(600)
    await shot(page, `conditions-details-options-${locale}.png`, page.locator('.quest-conditions-dialog'))
    await page.keyboard.press('Escape')
  })
}

test('«Условия квестов» on the phone width: beside «Текущие задания», «ещё N» unfolds the list', async ({ page }) => {
  test.setTimeout(120_000)
  await openOverview(page, 'ru', { width: 390, height: 900 })
  const card = page.locator('.quest-conditions-card')
  await expect(card).toBeVisible({ timeout: 45_000 })
  // no horizontal scroll
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  // «Текущие задания» and this card share the first row
  await expect.poll(async () => {
    const [cardBox, tasksBox] = await Promise.all([card.boundingBox(), page.locator('[data-block="stat-tasks"] .stat-card').boundingBox()])
    return cardBox && tasksBox ? Math.abs(cardBox.y - tasksBox.y) : Infinity
  }).toBeLessThan(2)
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'conditions-card-phone-ru.png') })
  await card.locator('.qc-count').click()
  const list = card.locator('.qc-list')
  await expect(list).toHaveClass(/is-open/)
  // the list stays inside the window
  const listBox = await list.boundingBox()
  expect(listBox!.x).toBeGreaterThanOrEqual(0)
  expect(listBox!.x + listBox!.width).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'conditions-phone-list-ru.png') })
})
