import { expect, test } from '@playwright/test'

test('command center opens Customs and marker details', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /следующий рейд начинается здесь/i })).toBeVisible()
  await page.getByRole('button', { name: /открыть карту/i }).click()
  await expect(page.getByText('КОНТЕКСТ КАРТЫ')).toBeVisible()
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await page.locator('.map-marker').first().click()
  await expect(page.getByRole('button', { name: /закрыть карточку/i })).toBeVisible()
})

test('quest progress persists after reload', async ({ page }) => {
  await page.goto('/#/quests')
  const complete = page.getByRole('button', { name: /отметить выполненным:/i }).first()
  const label = await complete.getAttribute('aria-label')
  await complete.click()
  await page.reload()
  await page.getByRole('button', { name: 'Выполненные' }).click()
  await expect(page.getByRole('button', { name: label?.replace('Отметить выполненным:', 'Снять выполнение:') ?? '' })).toBeVisible()
})

test('Icebreaker floor selector swaps the tile layer immediately', async ({ page }) => {
  await page.goto('/#/maps/icebreaker')
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await expect(page.locator('.map-hud')).toContainText('ЛАЗАРЕТ')

  await page.getByRole('button', { name: 'Главная палуба', exact: true }).click()

  await expect(page.locator('.map-hud')).toContainText('ГЛАВНАЯ ПАЛУБА')
  await expect(page.locator('.leaflet-tile[src*="/14_bridge/"]').first()).toBeVisible()
})

test('quest can be completed from the left edge of its card', async ({ page }) => {
  await page.goto('/#/quests')
  const complete = page.getByRole('button', { name: /отметить выполненным:/i }).first()
  await expect(complete).toBeVisible()
  const label = await complete.getAttribute('aria-label')
  await complete.click()
  await page.getByRole('button', { name: 'Выполненные' }).click()
  await expect(page.getByRole('button', { name: label?.replace('Отметить выполненным:', 'Снять выполнение:') ?? '' })).toBeVisible()
})
