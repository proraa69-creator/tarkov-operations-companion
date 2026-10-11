import { expect, test, type Page } from '@playwright/test'
import { createLocalProfile } from '../domain/progress'
import { ammoPayload, FX, FX_CATEGORY, gunsPayload, modsPayload } from '../arsenal/fixtures/gunFixture'

// «Оружейник» end to end, offline. json.tarkov.dev answers in the exact shape tarkov-data-manager's updateStaticApi writes
// (bare ids, `buildAttributes` with all ten stats, the unused ones 0, category names only in the items file); the
// gun catalogue comes from the GraphQL fixture. Names are in English with the `_ru` dictionaries, as upstream.
const MECHANIC = 'tr-mechanic'
const PART = { one: 'gs-part-1', two: 'gs-part-2', three: 'gs-part-3' }
const stats = (wanted: Record<string, [string, number]>) => Object.fromEntries(
  ['accuracy', 'durability', 'effectiveDistance', 'ergonomics', 'height', 'magazineCapacity', 'muzzleVelocity', 'recoil', 'weight', 'width']
    .map((name) => [name, wanted[name] ? { compareMethod: wanted[name][0], value: wanted[name][1] } : { compareMethod: '>=', value: 0 }]),
)
const task = (id: string, part: number, level: number, previous: string | undefined, objective: Record<string, unknown>) => ({
  id, name: `Gunsmith - Part ${part}`, normalizedName: `gunsmith-part-${part}`, trader: MECHANIC, minPlayerLevel: level, kappaRequired: true,
  experience: 4000 + part * 1000, taskRequirements: previous ? [{ task: previous, status: ['complete'] }] : [], finishRewards: { items: [] },
  objectives: [{ id: `${id}-o`, type: 'buildWeapon', description: `Modify the weapon (Part ${part}) to comply with the given specifications`, optional: false, maps: [], ...objective }],
})

const catalog: Record<string, unknown> = {
  tasks: {
    tasks: {
      [PART.one]: task(PART.one, 1, 2, undefined, { item: FX.ak, containsAll: [FX.akMuzzle], containsCategory: [], buildAttributes: stats({ durability: ['>=', 60] }) }),
      [PART.two]: task(PART.two, 2, 7, PART.one, {
        item: FX.m4, containsAll: [FX.suppressor, FX.holo], containsCategory: [FX_CATEGORY.foregrip],
        buildAttributes: stats({ durability: ['>=', 60], ergonomics: ['>=', 48], recoil: ['<=', 200], magazineCapacity: ['>=', 60], effectiveDistance: ['>=', 300] }),
      }),
      [PART.three]: task(PART.three, 3, 30, PART.two, { item: FX.mp7, containsAll: [], containsCategory: [], buildAttributes: stats({ weight: ['<=', 2.5] }) }),
    },
  },
  tasks_ru: Object.fromEntries([1, 2, 3].flatMap((part) => [[`Gunsmith - Part ${part}`, `Оружейник. Часть ${part}`], [`Modify the weapon (Part ${part}) to comply with the given specifications`, 'Модифицировать оружие в соответствии с требованиями']])),
  traders: { [MECHANIC]: { id: MECHANIC, name: 'Mechanic', levels: [] } },
  traders_ru: { Mechanic: 'Механик' },
  maps: { maps: {} },
  items: {
    items: Object.fromEntries([
      [FX.m4, 'Colt M4A1 5.56x45 assault rifle', 'M4A1', ['gun'], 34000], [FX.ak, 'Kalashnikov AK-74N 5.45x39 assault rifle', 'AK-74N', ['gun'], 29000],
      [FX.mp7, 'HK MP7A1 4.6x30 submachine gun', 'MP7A1', ['gun'], 41000], [FX.suppressor, 'SureFire SOCOM556-RC2 5.56x45 sound suppressor', 'RC2', ['mods'], 0],
      [FX.holo, 'EOTech EXPS3 holographic sight', 'EXPS3', ['mods'], 38000], [FX.akMuzzle, 'AK-74 6P20 muzzle brake', '6P20', ['mods'], 1800],
    ].map(([id, name, shortName, types, price]) => [id, { id, name, shortName, types, iconLink: `https://assets.tarkov.dev/${shortName}-icon.webp`, lastLowPrice: price }])),
    itemCategories: { [FX_CATEGORY.foregrip]: { id: FX_CATEGORY.foregrip, name: 'Foregrip', normalizedName: 'foregrip', parent: FX_CATEGORY.mod, children: [] } },
  },
  items_ru: { Foregrip: 'Тактическая рукоятка', 'Colt M4A1 5.56x45 assault rifle': 'Штурмовая винтовка Colt M4A1 5.56x45', 'SureFire SOCOM556-RC2 5.56x45 sound suppressor': 'Глушитель SureFire SOCOM556-RC2 5.56x45', 'EOTech EXPS3 holographic sight': 'Голографический прицел EOTech EXPS3' },
  hideout: {},
}

const RIFLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 200"><g fill="#4d5a50" stroke="#8c9a8f" stroke-width="2"><rect x="40" y="88" width="300" height="34" rx="6"/><rect x="330" y="96" width="150" height="14" rx="4"/><rect x="250" y="120" width="26" height="54" rx="4"/><path d="M40 92 L4 84 L4 140 L40 124 Z"/></g></svg>`
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#26302a" stroke="#56645a"/><path d="M14 40 L50 24" stroke="#a9b6ac" stroke-width="6" stroke-linecap="round"/></svg>`

async function openOverview(page: Page) {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'json.tarkov.dev') {
      const endpoint = url.pathname.split('/').pop() ?? ''
      return route.fulfill({ json: { data: catalog[endpoint] ?? {} } })
    }
    if (url.hostname === 'api.tarkov.dev') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { query?: string; variables?: { lang?: 'ru' | 'en' } }
      const lang = body.variables?.lang === 'en' ? 'en' : 'ru'
      const payload = body.query?.includes('RaidOsGuns') ? gunsPayload(lang) : body.query?.includes('RaidOsMods') ? modsPayload(lang) : body.query?.includes('RaidOsAmmo') ? ammoPayload(lang) : { data: {} }
      return route.fulfill({ json: payload })
    }
    if (url.hostname === 'assets.tarkov.dev') return route.fulfill({ contentType: 'image/svg+xml', body: /512|preset/.test(url.pathname) ? RIFLE_SVG : ICON_SVG })
    return route.abort()
  })
  const profile = createLocalProfile('Оператор', 'gunsmith-e2e')
  const now = '2026-10-11T08:00:00.000Z'
  const pvp = {
    ...profile.modes.pvp,
    playerLevel: 20,
    taskProgress: {
      [PART.one]: { taskId: PART.one, status: 'completed' as const, source: 'eft-log' as const, updatedAt: now },
      [PART.two]: { taskId: PART.two, status: 'active' as const, source: 'eft-log' as const, updatedAt: now },
    },
  }
  await page.addInitScript((saved) => {
    if (sessionStorage.getItem('gunsmith-e2e')) return
    sessionStorage.setItem('gunsmith-e2e', '1')
    sessionStorage.setItem('tarkov-account-gate-skipped', '1')
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: saved.id, profiles: [saved] }))
    localStorage.setItem('tarkov-operations-locale-v1', 'ru')
  }, { ...profile, modes: { ...profile.modes, pvp } })
  await page.setViewportSize({ width: 1600, height: 1300 })
  await page.goto('/#/')
}

test('«Оружейник»: Overview block and «Как собрать» from json.tarkov.dev data', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await openOverview(page)
  const panel = page.locator('.gunsmith-panel')
  await expect(panel).toBeVisible({ timeout: 45_000 })
  await expect(panel).toContainText('выполнено 1 из 3')
  await expect(panel.locator('.gunsmith-chip')).toHaveCount(3)
  // The part taken in the game is here, not in «Текущие задания».
  await expect(panel.getByRole('button', { name: /Оружейник\. Часть 2/ })).toBeVisible()
  await expect(page.locator('.panel', { hasText: 'Текущие задания' }).getByText('Оружейник. Часть 2')).toHaveCount(0)

  await panel.getByRole('button', { name: /Оружейник\. Часть 2/ }).click()
  const details = panel.locator('.gunsmith-details')
  await expect(details).toContainText('Штурмовая винтовка Colt M4A1')
  for (const text of ['Эргономика', '≥ 48', 'Отдача', '≤ 200', 'Вместимость магазина', 'Эффективная дальность', 'Прочность', 'Тактическая рукоятка', 'RC2', 'EXPS3']) await expect(details).toContainText(text)
  // The stats the part does not ask for (0 upstream) are not listed.
  for (const text of ['Ширина', 'Высота', 'Точность', 'Начальная скорость']) await expect(details).not.toContainText(text)
  const shot = async (name: string, target = page.locator('main')) => {
    await target.screenshot({ path: testInfo.outputPath(name) })
    if (process.env.GUNSMITH_SCREENSHOT_DIR) await target.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/${name}` })
  }
  await shot('gunsmith-overview-ru.png', panel)

  await panel.getByRole('link', { name: /Как собрать/ }).click()
  await expect(page.getByRole('heading', { name: 'Оружейник', level: 1 })).toBeVisible()
  await expect(page.getByText('Как собрать · пример сборки')).toBeVisible()
  const buy = page.locator('main').getByText('Что купить').locator('..')
  await expect(buy).toContainText('SOCOM556-RC2', { timeout: 30_000 })
  await expect(buy).toContainText('EXPS3')
  await expect(buy).toContainText('AFG')
  await shot('gunsmith-page-ru.png')
})
