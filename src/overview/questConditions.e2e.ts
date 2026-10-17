import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createLocalProfile } from '../domain/progress'

// «Сбор на рейд» (was «Условия квестов») and «Текущие задания» / «Квесты на карте» without a gear section end to end, offline: json.tarkov.dev answers from the fixture of real regular/* data
// (src/data/__fixtures__/tarkovDevConditionQuests.json). Pictures: QC_ASSET_DIR may hold tarkov.dev's real images
// (named by their path, «/» as «__»); without it every picture is a plain placeholder. QC_SCREENSHOT_DIR saves the shots.
const FEED = JSON.parse(readFileSync(new URL('../data/__fixtures__/tarkovDevConditionQuests.json', import.meta.url), 'utf8')) as Record<string, unknown>
const ASSETS = process.env.QC_ASSET_DIR
const SHOTS = process.env.QC_SCREENSHOT_DIR
const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#26302a" stroke="#56645a"/><path d="M14 40 L50 24" stroke="#a9b6ac" stroke-width="6" stroke-linecap="round"/></svg>`

const PATRIOT = '64f5deac39e45b527a7c4232'
const ACTIVE = [PATRIOT, '65734c186dc1e402c80dc19e', '5bc4856986f77454c317bea7', '5c1234c286f77406fa13baeb', '60e729cf5698ee7b05057439']

async function openOverview(page: Page, locale: 'ru' | 'en', viewport: { width: number; height: number }, path = '/#/') {
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
    // The one-off «Сбор на рейд» tip (src/onboarding/RaidLoadoutTip.tsx) is accepted: it would cover the card.
    localStorage.setItem('raidos-raid-loadout-tip-v1', 'seen')
  }, { saved: { ...profile, modes: { ...profile.modes, pvp } }, lang: locale })
  await page.setViewportSize(viewport)
  await page.goto(path)
}

const shot = async (page: Page, name: string, target = page.locator('main')) => {
  if (SHOTS) await target.screenshot({ path: join(SHOTS, name) })
}

for (const locale of ['ru', 'en'] as const) {
  test(`«Сбор на рейд» on the Overview (${locale}): the card, the full-size unfolded cards, the build and «Текущие задания»`, async ({ page }) => {
    test.setTimeout(120_000)
    await openOverview(page, locale, { width: 1600, height: 1100 })
    const card = page.locator('.quest-conditions-card')
    await expect(card).toBeVisible({ timeout: 45_000 })
    await expect(card.locator(':scope > .qc-head .stat-label')).toHaveText(locale === 'en' ? 'Raid loadout' : 'Сбор на рейд')
    // the English catalog lends its names once loaded
    if (locale === 'en') await expect(page.locator('.current-tasks')).toContainText('Job for a Patriot', { timeout: 45_000 })
    await page.waitForLoadState('networkidle')
    // the card keeps the stats row's height: as tall as «Текущие задания» beside it
    await expect.poll(async () => {
      const [cardBox, tasksBox] = await Promise.all([card.boundingBox(), page.locator('[data-block="stat-tasks"] .stat-card').boundingBox()])
      return cardBox && tasksBox ? Math.abs(cardBox.height - tasksBox.height) : Infinity
    }).toBeLessThan(2)
    await page.waitForTimeout(400)
    await shot(page, `cond2-card-${locale}.png`, page.locator('.stat-grid'))

    // hover: the card grows in place, its quest in full and every other quest of Streets below as a full-size card
    await card.hover()
    const pop = card.locator('.qc-pop')
    await expect(pop).toHaveClass(/is-open/)
    // «Работа для патриота», «Стиляги» (Streets) and «Тарковский стрелок. Часть 6» (any map); «Подстава» (Customs) and «Ловкач» (Woods) not
    await expect(pop.locator('.qc-card')).toHaveCount(3)
    await expect(pop.locator('.qc-card.is-shown')).toHaveClass(/is-full/)
    // the list cards are the main card's size: the same strip of pictures, the same name
    const mainStrip = await card.locator(':scope > .qc-main .qc-gear').boundingBox()
    const listStrip = await pop.locator('.qc-list .qc-card .qc-rest .qc-gear').first().boundingBox()
    expect(Math.abs((listStrip?.height ?? 0) - (mainStrip?.height ?? 0))).toBeLessThan(2)
    const fontSize = (selector: string) => card.locator(selector).first().evaluate((node) => getComputedStyle(node).fontSize)
    expect(await fontSize('.qc-list .qc-card .qc-name')).toBe(await fontSize(':scope > .qc-main .qc-name'))
    const patriotName = locale === 'en' ? 'Job for a Patriot' : 'Работа для патриота'
    const patriotCard = pop.locator('.qc-card', { hasText: patriotName })
    await patriotCard.hover()
    await expect(patriotCard.locator('.qc-all')).toBeVisible()
    await expect(patriotCard.locator('.qc-all .qc-chip')).toHaveCount(3)
    // over the grid, never pushing it
    const popBox = await pop.boundingBox()
    expect(popBox!.height).toBeLessThanOrEqual(1100 * 0.7 + 1)
    await page.waitForTimeout(400)
    await shot(page, `cond2-unfolded-${locale}.png`, page.locator('main'))

    // click: the build
    await patriotCard.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.qc-weapon-card')).toContainText(locale === 'en' ? 'AK-12' : 'АК-12')
    await expect(dialog).toContainText(locale === 'en' ? 'PS-320' : 'ПС-320')
    await page.waitForTimeout(600)
    await shot(page, `cond2-dialog-${locale}.png`, page.locator('.quest-conditions-dialog'))
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(card.locator(':scope > .qc-main .qc-name')).toHaveText(patriotName)

    // «Текущие задания»: one list, as before (owner, 15.10.2026: «Вот этот блок удали вообще»)
    await page.mouse.move(5, 5)
    const tasks = page.locator('.current-tasks')
    await expect(tasks.locator('.gear-section')).toHaveCount(0)
    await expect(tasks.locator('.quest-row', { hasText: patriotName })).toHaveCount(1)
    await page.waitForTimeout(400)
    await shot(page, `cond2-overview-tasks-${locale}.png`, page.locator('.overview-grid, main').first())

    // «Тарковский стрелок. Часть 6»: any of the bolt-action rifles, any one of thirty suppressors
    await card.hover()
    const shooterName = locale === 'en' ? 'The Tarkov Shooter - Part 6' : 'Тарковский стрелок. Часть 6'
    await pop.locator('.qc-card', { hasText: shooterName }).click()
    // a choice is one example and «или любое из N» (owner, 15.10.2026: «не должно быть огромных списков»)
    await expect(dialog.locator('.qc-weapon-card')).toHaveCount(1)
    await expect(dialog.locator('.qc-choice-more').first()).toContainText(locale === 'en' ? 'or any of 10' : 'или любое из 10')
    await expect(dialog.locator('.qc-block', { hasText: locale === 'en' ? 'Weapon parts' : 'Модули на оружии' }).locator('.gs-part')).toHaveCount(1)
    await page.waitForTimeout(600)
    await shot(page, `cond2-dialog-options-${locale}.png`, page.locator('.quest-conditions-dialog'))
    await page.keyboard.press('Escape')
  })

  test(`Maps (${locale}): «Квесты на карте» is one list again, the sheet adds no gear block`, async ({ page }) => {
    test.setTimeout(120_000)
    await openOverview(page, locale, { width: 1600, height: 1000 }, '/#/maps/streets-of-tarkov')
    const panel = page.locator('.map-detail')
    const patriotName = locale === 'en' ? 'Job for a Patriot' : 'Работа для патриота'
    const row = panel.locator('.quest-map-row', { hasText: patriotName })
    await expect(row).toBeVisible({ timeout: 45_000 })
    await expect(panel.locator('.map-gear-section')).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    await shot(page, `cond2-map-panel-${locale}.png`, panel)
    await row.locator('.quest-map-row-main').click()
    await expect(page.locator('.map-quest-sheet.is-open')).toBeVisible()
    await expect(page.locator('.map-quest-sheet.is-open .qc-weapon-card')).toHaveCount(0)
    await page.waitForTimeout(700)
    await shot(page, `cond2-map-sheet-${locale}.png`, page.locator('main'))
  })
}

test('«Сбор на рейд» on the phone width: beside «Текущие задания», «ещё N» unfolds the full-size cards', async ({ page }) => {
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
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'cond2-phone-card-ru.png') })
  await card.locator(':scope > .qc-head .qc-count').click()
  const pop = card.locator('.qc-pop')
  await expect(pop).toHaveClass(/is-open/)
  await expect(pop.locator('.qc-card')).toHaveCount(3)
  // it stays inside the window
  const popBox = await pop.boundingBox()
  expect(popBox!.x).toBeGreaterThanOrEqual(0)
  expect(popBox!.x + popBox!.width).toBeLessThanOrEqual(390)
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'cond2-phone-unfolded-ru.png') })
  // a tapped card opens its build
  await pop.locator('.qc-list .qc-card').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'cond2-phone-dialog-ru.png') })
  await page.keyboard.press('Escape')
  // «Текущие задания»: one list, no gear section
  const tasks = page.locator('.current-tasks')
  await tasks.scrollIntoViewIfNeeded()
  await expect(tasks.locator('.gear-section')).toHaveCount(0)
  await page.waitForTimeout(400)
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'cond2-phone-tasks-ru.png') })
})
