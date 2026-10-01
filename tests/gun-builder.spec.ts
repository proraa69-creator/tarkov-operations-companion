import { expect, test, type Page } from '@playwright/test'
import { ammoPayload, gunsPayload, modsPayload } from '../src/arsenal/fixtures/gunFixture'

// Offline: tarkov.dev GraphQL answers come from the fixture, item images are drawn placeholders.
const SHOTS = process.env.GUN_BUILDER_SHOTS ?? 'test-results/gun-builder'

const RIFLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 200"><g fill="#4d5a50" stroke="#8c9a8f" stroke-width="2">
<rect x="40" y="88" width="300" height="34" rx="6"/><rect x="330" y="96" width="150" height="14" rx="4"/><rect x="190" y="120" width="34" height="60" rx="6" transform="rotate(12 207 150)"/>
<rect x="250" y="120" width="26" height="54" rx="4"/><path d="M40 92 L4 84 L4 140 L40 124 Z"/><rect x="150" y="66" width="80" height="22" rx="5"/></g></svg>`
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#26302a" stroke="#56645a"/><path d="M14 40 L50 24" stroke="#a9b6ac" stroke-width="6" stroke-linecap="round"/></svg>`

async function mockTarkovDev(page: Page) {
  await page.route('https://json.tarkov.dev/**', (route) => route.abort())
  await page.route('https://assets.tarkov.dev/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: /512/.test(route.request().url()) ? RIFLE_SVG : ICON_SVG }))
  await page.route('https://api.tarkov.dev/graphql', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { query?: string; variables?: { lang?: 'ru' | 'en' } }
    const lang = body.variables?.lang === 'en' ? 'en' : 'ru'
    const payload = body.query?.includes('RaidOsGuns') ? gunsPayload(lang) : body.query?.includes('RaidOsMods') ? modsPayload(lang) : body.query?.includes('RaidOsAmmo') ? ammoPayload(lang) : { data: {} }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) })
  })
}

test.beforeEach(async ({ page }) => {
  await mockTarkovDev(page)
  await page.setViewportSize({ width: 1720, height: 1080 })
})

test('gun builder: preset, slot picker, conflicts, stats and saved builds (RU)', async ({ page }) => {
  test.setTimeout(150_000)
  await page.goto('/#/arsenal/builder')
  await expect(page.getByRole('link', { name: 'Сборщик оружия' })).toHaveClass(/active/)
  await expect(page.getByRole('heading', { name: 'Сборщик оружия' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Colt M4A1/ })).toBeVisible()
  // Default preset: 56 × (1 − 0.19) = 45.
  await expect(page.locator('.gb-stat').first()).toContainText('45')

  // Swap the stock (nested under the buffer tube) for the CTR: less recoil, green delta.
  await page.getByRole('button', { name: /^Приклад: Приклад Colt M4/ }).click()
  await page.getByRole('option', { name: /Magpul CTR/ }).click()
  await expect(page.locator('.gb-stat').first()).toContainText('41')
  await expect(page.locator('.gb-stat').first().locator('.gb-delta.better')).toHaveText('−4')

  // A2 front-sight gas block conflicts with the SMR handguard: install SMR, the A2 is disabled.
  await page.getByRole('button', { name: /^Цевьё:/ }).click()
  await page.getByRole('option', { name: /Geissele SMR/ }).click()
  await page.getByRole('button', { name: /^Газоблок:/ }).click()
  await expect(page.getByRole('option', { name: /Colt A2/ })).toBeDisabled()
  await expect(page.locator('.gb-candidate:disabled')).toContainText('Конфликт')
  await page.screenshot({ path: `${SHOTS}/builder-ru.png`, fullPage: true })
  await page.getByRole('button', { name: /^Газоблок:/ }).click()

  await page.getByPlaceholder('Название сборки').fill('Тихий M4')
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await expect(page.locator('.gb-saved')).toContainText('Тихий M4')

  // Saved builds are per mode. Offline, the app's main catalogue for a new mode needs a while to give up on json.tarkov.dev.
  await page.getByRole('button', { name: 'PvE', exact: true }).click()
  await expect(page.locator('.gb-saved')).toContainText('пока нет', { timeout: 90_000 })
  await page.getByRole('button', { name: 'PvP', exact: true }).click()
  await expect(page.locator('.gb-saved')).toContainText('Тихий M4', { timeout: 30_000 })
})

test('gun builder: empty build, required slots and English', async ({ page }) => {
  await page.goto('/#/arsenal/builder')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Gun Builder' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Gun Builder' })).toBeVisible()
  await expect(page.getByText('ARSENAL', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Default preset' }).isVisible()
  await page.screenshot({ path: `${SHOTS}/builder-en.png`, fullPage: true })
  await page.getByRole('button', { name: 'Empty', exact: true }).click()
  await expect(page.locator('.gb-alert')).toContainText('Required mods missing')
  await expect(page.locator('.gb-alert')).toContainText('Magazine')
  await page.getByRole('row', { name: /M995/ }).click()
  await expect(page.getByRole('row', { name: /M995/ })).toHaveClass(/selected-row/)
  await page.screenshot({ path: `${SHOTS}/builder-en-empty.png`, fullPage: true })

  await page.getByRole('combobox', { name: 'Class' }).selectOption('handgun')
  await expect(page.locator('.gb-weapon-row')).toHaveCount(1)
  await page.locator('.gb-weapon-row').first().click()
  await expect(page.getByRole('heading', { name: /Glock 17/ })).toBeVisible()
})
