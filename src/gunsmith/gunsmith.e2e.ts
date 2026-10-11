import { expect, test, type Page } from '@playwright/test'
import { createLocalProfile } from '../domain/progress'
import { ammoPayload, FX, FX_CATEGORY, gunsPayload, modsPayload } from '../arsenal/fixtures/gunFixture'

// «Оружейник» end to end, offline. json.tarkov.dev answers in the exact shape tarkov-data-manager's updateStaticApi writes
// (bare ids, `buildAttributes` with all ten stats, the unused ones 0, category names only in the items file); the
// gun catalogue comes from the GraphQL fixture. Names are in English with the `_ru` dictionaries, as upstream; the parts
// are named by their weapon, as in the game now («Оружейник. АКС-74Н»), with no part number anywhere.
const MECHANIC = 'tr-mechanic'
const WEAPON = { 1: ['AK-74N', 'АК-74Н'], 2: ['M4A1', 'M4A1'], 3: ['MP7A1', 'MP7A1'] } as Record<number, [string, string]>
const PART = { one: 'gs-part-1', two: 'gs-part-2', three: 'gs-part-3' }
const stats = (wanted: Record<string, [string, number]>) => Object.fromEntries(
  ['accuracy', 'durability', 'effectiveDistance', 'ergonomics', 'height', 'magazineCapacity', 'muzzleVelocity', 'recoil', 'weight', 'width']
    .map((name) => [name, wanted[name] ? { compareMethod: wanted[name][0], value: wanted[name][1] } : { compareMethod: '>=', value: 0 }]),
)
const task = (id: string, part: number, level: number, previous: string | undefined, objective: Record<string, unknown>) => ({
  id, name: `Gunsmith - ${WEAPON[part][0]}`, normalizedName: `gunsmith-${WEAPON[part][0].toLowerCase()}`, trader: MECHANIC, minPlayerLevel: level, kappaRequired: true,
  experience: 4000 + part * 1000, taskRequirements: previous ? [{ task: previous, status: ['complete'] }] : [], finishRewards: { items: [] },
  wikiLink: `https://escapefromtarkov.fandom.com/wiki/Gunsmith_-_${WEAPON[part][0]}`,
  objectives: [{ id: `${id}-o`, type: 'buildWeapon', description: `Modify the weapon (Part ${part}) to comply with the given specifications`, optional: false, maps: [], ...objective }],
})

const ITEMS: Array<[id: string, english: string, shortName: string, types: string[], price: number, russian?: string]> = [
  [FX.m4, 'Colt M4A1 5.56x45 assault rifle', 'M4A1', ['gun'], 34000, 'Штурмовая винтовка Colt M4A1 5.56x45'],
  [FX.ak, 'Kalashnikov AK-74N 5.45x39 assault rifle', 'AK-74N', ['gun'], 29000],
  [FX.mp7, 'HK MP7A1 4.6x30 submachine gun', 'MP7A1', ['gun'], 41000],
  [FX.suppressor, 'SureFire SOCOM556-RC2 5.56x45 sound suppressor', 'RC2', ['mods'], 0, 'Глушитель SureFire SOCOM556-RC2 5.56x45'],
  [FX.holo, 'EOTech EXPS3 holographic sight', 'EXPS3', ['mods'], 38000, 'Голографический прицел EOTech EXPS3'],
  [FX.akMuzzle, 'AK-74 6P20 muzzle brake', '6P20', ['mods'], 1800],
  [FX.stockMoe, 'AR-15 Magpul MOE stock', 'MOE', ['mods'], 6900, 'Приклад Magpul MOE для AR-15'],
]

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
  tasks_ru: Object.fromEntries([1, 2, 3].flatMap((part) => [[`Gunsmith - ${WEAPON[part][0]}`, `Оружейник. ${WEAPON[part][1]}`], [`Modify the weapon (Part ${part}) to comply with the given specifications`, 'Модифицировать оружие в соответствии с требованиями']])),
  // Traders with their loyalty levels (player level each needs) and portraits, keyed like the offers (normalizedName).
  traders: Object.fromEntries([[MECHANIC, 'Mechanic', 'mechanic'], ['tr-peacekeeper', 'Peacekeeper', 'peacekeeper'], ['tr-skier', 'Skier', 'skier'], ['tr-prapor', 'Prapor', 'prapor']]
    .map(([id, name, key]) => [id, { id, name, normalizedName: key, imageLink: `https://assets.tarkov.dev/${key}-trader.webp`, levels: [1, 15, 26, 36].map((player, index) => ({ level: index + 1, requiredPlayerLevel: player })) }])),
  traders_ru: { Mechanic: 'Механик', Peacekeeper: 'Миротворец', Skier: 'Лыжник', Prapor: 'Прапор' },
  maps: { maps: {} },
  // Upstream keeps translation keys in the data («<id> Name») and the texts in `items_en` / `items_ru` (the Russian one
  // falls back to English where it has no translation), as tarkov-data-manager writes them.
  items: {
    items: Object.fromEntries(ITEMS.map(([id, , shortName, types, price]) => [id, { id, name: `${id} Name`, shortName: `${id} ShortName`, types, iconLink: `https://assets.tarkov.dev/${shortName}-icon.webp`, lastLowPrice: price }])),
    itemCategories: { [FX_CATEGORY.foregrip]: { id: FX_CATEGORY.foregrip, name: 'Foregrip', normalizedName: 'foregrip', parent: FX_CATEGORY.mod, children: [] } },
  },
  items_en: { Foregrip: 'Foregrip', ...Object.fromEntries(ITEMS.flatMap(([id, name, shortName]) => [[`${id} Name`, name], [`${id} ShortName`, shortName]])) },
  items_ru: { Foregrip: 'Тактическая рукоятка', ...Object.fromEntries(ITEMS.flatMap(([id, name, shortName, , , russian]) => [[`${id} Name`, russian ?? name], [`${id} ShortName`, shortName]])) },
  hideout: {},
}

// The task's English wiki page as the wiki API renders it: «Related Quest Items» with traders and loyalty levels.
const wikiLink = (title: string) => `<a href="/wiki/${title.replace(/ /g, '_')}" title="${title}">${title}</a>`
const wikiRow = (item: string, sellers: string, requirement = '') => `<tr><td><a href="/wiki/${item.replace(/ /g, '_')}" class="image" title="${item}"><img alt="" src="x.png"></a></td><td>${wikiLink(item)}</td><td>1</td><td>${requirement}</td><td>${sellers}</td></tr>`
const WIKI_PAGES: Record<string, string> = {
  'Gunsmith - M4A1': `<div class="mw-parser-output"><p>Hand the weapon over to ${wikiLink('Mechanic')}.</p><table class="wikitable"><tbody>
<tr><th colspan="5">Related Quest Items</th></tr><tr><th>Icon</th><th>Item name</th><th>Amount</th><th>Requirement</th><th>Notes</th></tr>
${wikiRow('Colt M4A1 5.56x45 assault rifle', `Can be purchased from ${wikiLink('Peacekeeper')} LL1.`, 'Has to be modified and handed over')}
${wikiRow('SureFire SOCOM556-RC2 5.56x45 sound suppressor', `${wikiLink('Peacekeeper')} LL3`, 'Has to be installed')}
${wikiRow('EOTech EXPS3 holographic sight', `${wikiLink('Mechanic')} LL2`, 'Has to be installed')}
${wikiRow('AR-15 Magpul MOE stock', `${wikiLink('Mechanic')} LL1<br>${wikiLink('Skier')} LL2 (Barter)`)}
</tbody></table></div>`,
}

const RIFLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 200"><g fill="#4d5a50" stroke="#8c9a8f" stroke-width="2"><rect x="40" y="88" width="300" height="34" rx="6"/><rect x="330" y="96" width="150" height="14" rx="4"/><rect x="250" y="120" width="26" height="54" rx="4"/><path d="M40 92 L4 84 L4 140 L40 124 Z"/></g></svg>`
const TRADER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3b3a33"/><circle cx="32" cy="26" r="13" fill="#b49a7c"/><path d="M8 64 C10 44 54 44 56 64 Z" fill="#4c5a4a"/></svg>`
const itemIcon = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="4" fill="#1d2420" stroke="#56645a"/><path d="M12 40 L46 26 L52 30 L18 46 Z" fill="#8e9b91"/><circle cx="22" cy="40" r="5" fill="#5d6a60"/><text x="60" y="12" font-family="sans-serif" font-size="9" font-weight="700" fill="#e6ece7" text-anchor="end">${label.replace(/[<&]/g, '')}</text></svg>`
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#26302a" stroke="#56645a"/><path d="M14 40 L50 24" stroke="#a9b6ac" stroke-width="6" stroke-linecap="round"/></svg>`

async function openOverview(page: Page, { modsDown = false } = {}) {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'json.tarkov.dev') {
      const endpoint = url.pathname.split('/').pop() ?? ''
      return route.fulfill({ json: { data: catalog[endpoint] ?? {} } })
    }
    if (url.hostname === 'escapefromtarkov.fandom.com' && url.pathname === '/api.php' && url.searchParams.get('action') === 'parse') {
      const html = WIKI_PAGES[url.searchParams.get('page') ?? '']
      return route.fulfill({ json: html ? { parse: { text: html } } : { error: { code: 'missingtitle' } } })
    }
    if (url.hostname === 'api.tarkov.dev') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { query?: string; variables?: { lang?: 'ru' | 'en' } }
      // The server has no mod data yet (owner, 11.10.2026: «Данные модулей сейчас недоступны»).
      if (modsDown && body.query?.includes('RaidOsMods')) return route.fulfill({ status: 503, json: { error: 'Данные ещё не подготовлены на сервере' } })
      const lang = body.variables?.lang === 'en' ? 'en' : 'ru'
      const payload = body.query?.includes('RaidOsGuns') ? gunsPayload(lang) : body.query?.includes('RaidOsMods') ? modsPayload(lang) : body.query?.includes('RaidOsAmmo') ? ammoPayload(lang) : { data: {} }
      return route.fulfill({ json: payload })
    }
    if (url.hostname === 'assets.tarkov.dev') {
      // Each item its own picture, labelled with its short name like the game's inventory icons.
      const icon = /^\/(.+)-icon\.webp$/.exec(url.pathname)
      return route.fulfill({ contentType: 'image/svg+xml', body: /trader/.test(url.pathname) ? TRADER_SVG : /512|preset/.test(url.pathname) ? RIFLE_SVG : icon ? itemIcon(decodeURIComponent(icon[1])) : ICON_SVG })
    }
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

/** Hovers a module card once the previous hover window has closed; returns the window. */
async function hoverWindow(page: Page, target: ReturnType<Page['locator']>) {
  await page.mouse.move(0, 0)
  await expect(page.locator('.hover-card')).toHaveCount(0)
  await target.hover()
  const window = page.locator('.hover-card')
  await expect(window).toHaveCount(1)
  return window
}

test('«Оружейник»: Overview block and «Как собрать» from json.tarkov.dev data', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await openOverview(page)
  const panel = page.locator('.gunsmith-panel')
  await expect(panel).toBeVisible({ timeout: 45_000 })
  // Just the current part by name: no part numbers, no chain strip.
  await expect(panel.locator('.gunsmith-current')).toHaveCount(1)
  await expect(panel).not.toContainText('выполнено')
  const current = panel.getByRole('button', { name: /Оружейник\. M4A1/ })
  await expect(current).toBeVisible()
  await expect(panel.locator('.panel-header .current-tasks-where')).toHaveText('Посмотреть все')
  // The part taken in the game is here, not in «Текущие задания».
  await expect(page.locator('.panel', { hasText: 'Текущие задания' }).getByText('Оружейник. M4A1')).toHaveCount(0)

  await current.click()
  const details = panel.locator('.gunsmith-details')
  await expect(details).toContainText('Штурмовая винтовка Colt M4A1')
  for (const text of ['Эргономика', '≥ 48', 'Отдача', '≤ 200', 'Вместимость магазина', 'Эффективная дальность', 'Прочность', 'Тактическая рукоятка']) await expect(details).toContainText(text)
  // The stats the part does not ask for (0 upstream) are not listed.
  for (const text of ['Ширина', 'Высота', 'Точность', 'Начальная скорость']) await expect(details).not.toContainText(text)
  // One block of modules: the ones the game checks and the wiki's build, each with its traders and loyalty level.
  // Peacekeeper sells the suppressor from level III, which the player (character level 20, nothing proves more) has not got.
  const modules = details.locator('.gs-block', { hasText: 'Обязательные модули' })
  await expect(modules).toHaveCount(1)
  await expect(details).not.toContainText('Сборка с вики')
  const suppressorCard = modules.locator('.gs-part', { hasText: 'RC2' })
  // The cards hold only the picture, the name and the price; who sells it is in the hover window.
  await expect(modules.locator('.gs-trader')).toHaveCount(0)
  for (const text of ['EXPS3', 'MOE']) await expect(modules).toContainText(text)
  // Hovering a module: what can go instead. The suppressor is asked for by the task itself.
  const required = await hoverWindow(page, suppressorCard)
  await expect(required).toContainText('Задание требует именно этот модуль')
  await expect(required.locator('.gs-trader.is-locked .gs-trader-level')).toHaveText('III', { timeout: 30_000 })
  await expect(required).toContainText('Миротворец — уровень 3 (у вас 1)')
  const window = await hoverWindow(page, modules.locator('.gs-part', { hasText: 'MOE' }))
  await expect(window).toContainText('Можно поставить вместо')
  await expect(window.locator('li').first()).toBeVisible({ timeout: 30_000 })
  await expect(window).toContainText(/Приклад|stock/)
  const shot = async (name: string, target = page.locator('main')) => {
    await target.screenshot({ path: testInfo.outputPath(name) })
    if (process.env.GUNSMITH_SCREENSHOT_DIR) await target.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/${name}` })
  }
  await shot('gunsmith-overview-ru.png', panel)
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-hover-ru.png` })
  await page.mouse.move(0, 0)

  await details.getByRole('link', { name: /Как собрать/ }).click()
  await expect(page.getByRole('heading', { name: 'Оружейник', level: 1 })).toBeVisible()
  await expect(page.getByText('Как собрать · пример сборки')).toBeVisible()
  const levels = page.locator('.gs-levels')
  await expect(levels).toBeVisible({ timeout: 30_000 })
  // The player sets Peacekeeper's real level: the suppressor becomes available from him.
  await levels.locator('.gs-level-button[title^="Миротворец"]').click()
  await levels.getByRole('menuitemradio', { name: 'LL3' }).click()
  const pageSuppressor = page.locator('main .gs-shop-row', { hasText: 'SOCOM556-RC2' })
  await expect(pageSuppressor.locator('.gs-trader.is-chosen .gs-trader-level')).toHaveText('III')
  await expect(pageSuppressor.locator('.gs-shop-price b')).toContainText('61')
  await expect(levels.locator('.gs-level-button[title^="Миротворец"]')).toContainText('свой')
  await shot('gunsmith-page-ru.png')
})

test('«Оружейник»: the wiki’s traders and loyalty levels on every part, also without the mod data', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await openOverview(page, { modsDown: true })
  const panel = page.locator('.gunsmith-panel')
  await expect(panel).toBeVisible({ timeout: 45_000 })
  await panel.getByRole('button', { name: /Оружейник\. M4A1/ }).click()
  const details = panel.locator('.gunsmith-details')
  await expect(details.locator('.gs-block', { hasText: 'Обязательные модули' })).toBeVisible({ timeout: 30_000 })
  // Hovering a part shows who sells it and from which level, from the wiki: Peacekeeper III (locked: nothing proves it yet).
  await expect((await hoverWindow(page, details.locator('.gs-part', { hasText: 'RC2' }))).locator('.gs-trader.is-locked .gs-trader-level')).toHaveText('III')
  await expect((await hoverWindow(page, details.locator('.gs-part', { hasText: 'EXPS3' }))).locator('.gs-trader-level')).toHaveText('II')
  // The rest of the wiki's build in the same block, with its barter.
  const stock = details.locator('.gs-block', { hasText: 'Обязательные модули' }).locator('.gs-part', { hasText: 'MOE' })
  const window = await hoverWindow(page, stock)
  await expect(window.locator('.gs-trader')).toHaveCount(2)
  await expect(window.locator('.gs-trader-barter')).toHaveCount(1)
  await expect(window).toContainText('Лыжник — уровень 2 (бартер')
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-hover-sellers-ru.png` })
  await page.mouse.move(0, 0)
  // Matched to the catalog item through upstream's English dictionary: its picture and Russian name, no availability text.
  await expect(stock.locator('img').first()).toHaveAttribute('src', /MOE-icon/)
  await expect(details).not.toContainText('нет на барахолке')
  await panel.screenshot({ path: testInfo.outputPath('gunsmith-wiki-sellers-ru.png') })
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await panel.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-wiki-sellers-ru.png` })

  // The Gunsmith page: the wiki's table is here, so no button to the wiki.
  await details.getByRole('link', { name: /Как собрать/ }).click()
  await expect(page.getByRole('heading', { name: 'Оружейник', level: 1 })).toBeVisible()
  // On the page the card also carries the item's full Russian name from the catalog.
  await expect(page.locator('main .gs-block', { hasText: 'Обязательные модули' }).locator('.gs-part', { hasText: 'Приклад Magpul MOE для AR-15' })).toBeVisible()
  // Without the mod data the hover window says when the alternatives come.
  await expect(await hoverWindow(page, page.locator('main .gs-part', { hasText: 'MOE' }))).toContainText('Аналоги появятся, когда загрузятся данные модулей')
  await expect(page.getByRole('link', { name: /Страница на Wiki/ })).toHaveCount(0)
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await page.locator('main').screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-wiki-page-ru.png` })
})
