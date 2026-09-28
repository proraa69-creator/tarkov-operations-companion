import { expect, test } from '@playwright/test'

// Stable offline UI regression suite; live catalogue integration is verified
// separately against the service. Never race placeholder IDs against live IDs.
test.beforeEach(async ({ page }) => {
  await page.route('https://json.tarkov.dev/**', (route) => route.abort())
})

test('command center opens Customs and marker details', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /следующий рейд начинается здесь/i })).toBeVisible()
  await page.getByRole('button', { name: /открыть карту/i }).click()
  await expect(page.getByText('ТОЧКИ НА КАРТЕ')).toBeVisible()
  await expect(page.locator('.leaflet-container')).toBeVisible()
  // At fit-to-map zoom multiple points may overlap; force the selected marker,
  // then verify that the actual details sheet is produced.
  await page.locator('.leaflet-marker-icon').first().click({ force: true })
  await expect(page.getByRole('button', { name: /закрыть карточку/i })).toBeVisible()
})

test('language round-trip translates the whole shell and keeps quest counts stable', async ({ page }) => {
  await page.goto('/#/quests')
  const countBefore = await page.locator('.quest-list .quest-item, .quest-catalog-list > *').count()
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Maps', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Current tasks', exact: true })).toBeVisible()
  expect(await page.locator('.quest-list .quest-item, .quest-catalog-list > *').count()).toBe(countBefore)
  await page.getByRole('button', { name: 'RU', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Обзор', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Карты', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Текущие задания', exact: true })).toBeVisible()
  expect(await page.locator('.quest-list .quest-item, .quest-catalog-list > *').count()).toBe(countBefore)
})

test('quests default to current and cannot be completed manually', async ({ page }) => {
  await page.goto('/#/quests')
  await expect(page.getByRole('button', { name: 'Текущие', exact: true })).toHaveClass('active')
  await expect(page.getByRole('button', { name: 'Все', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Сюжетные', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Доступные', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Недоступные', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /отметить выполненным|снять выполнение/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Выполненные', exact: true }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Выполненные', exact: true })).toHaveClass('active')
  await page.goto('/#/import')
  await expect(page.getByText('Быстрая ручная отметка')).toHaveCount(0)
})

test('map picker expands upward inside the raid card', async ({ page }) => {
  await page.goto('/')
  const before = await page.locator('.raid-map-name').boundingBox()
  const card = await page.locator('.raid-card').boundingBox()
  await page.getByRole('button', { name: 'Выбрать карту', exact: true }).click()
  await expect(page.locator('.raid-map-picker')).toHaveClass(/is-open/)
  await expect.poll(async () => {
    const name = await page.locator('.raid-map-name').boundingBox()
    const currentCard = await page.locator('.raid-card').boundingBox()
    return name!.y - currentCard!.y
  }).toBeLessThan(before!.y - card!.y - 30)
  const after = await page.locator('.raid-map-name').boundingBox()
  const movedCard = await page.locator('.raid-card').boundingBox()
  expect(after!.y).toBeGreaterThan(movedCard!.y)
  await page.locator('.raid-map-picker').getByRole('button', { name: 'Лес', exact: true }).click()
  await expect(page.locator('.raid-map-name')).toHaveText('Лес')
})

test('a key stays inside the flea market when its card opens', async ({ page }) => {
  await page.goto('/#/flea?tab=keys')
  await page.locator('.flea-item-link').first().click()
  await expect(page).toHaveURL(/flea\?tab=keys&selected=/)
  await expect(page.locator('.flea-detail')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ключи', exact: true })).toHaveClass('active')
  await page.getByRole('button', { name: 'Закрыть карточку', exact: true }).click()
  await expect(page.locator('.flea-detail')).toHaveCount(0)
})
