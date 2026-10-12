import { expect, test, type Page } from '@playwright/test'
import { createLocalProfile } from '../domain/progress'
import { FX, FX_CATEGORY, upstreamGunItems } from '../arsenal/fixtures/gunFixture'

// «Оружейник» end to end, offline. json.tarkov.dev answers in the exact shape tarkov-data-manager's updateStaticApi writes
// (bare ids, `buildAttributes` with all ten stats, the unused ones 0, category names only in the items file); the gun
// catalogue (weapons, parts, slots, trader offers) is read from the same items file, as the app does now. Names are
// translation keys with the texts in the `_en` / `_ru` dictionaries, as upstream; the parts are named by their weapon, as
// in the game now («Оружейник. АКС-74Н»), with no part number anywhere.
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

// The arsenal fixture's weapons, parts and rounds (src/arsenal/fixtures/gunFixture.ts) as json.tarkov.dev writes them.
const GUNS = upstreamGunItems()
// Each picture labelled with its item's short name, like the game's inventory icons.
const SHORT_NAMES = Object.fromEntries(Object.keys(GUNS.items).map((id) => [id, GUNS.names.en[`${id} ShortName`] ?? id]))

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
  // Traders with their loyalty levels (player level each needs) and portraits; the offers name them by id. Their names
  // are keys («<id> Nickname») with the texts in `traders_ru`, as upstream.
  traders: Object.fromEntries([MECHANIC, 'tr-peacekeeper', 'tr-skier', 'tr-prapor', 'tr-jaeger']
    .map((id) => [id, { id, name: `${id} Nickname`, normalizedName: id.slice(3), imageLink: `https://assets.tarkov.dev/${id.slice(3)}-trader.webp`, levels: [1, 15, 26, 36].map((player, index) => ({ level: index + 1, requiredPlayerLevel: player })) }])),
  traders_ru: Object.fromEntries([[MECHANIC, 'Механик'], ['tr-peacekeeper', 'Миротворец'], ['tr-skier', 'Лыжник'], ['tr-prapor', 'Прапор'], ['tr-jaeger', 'Егерь']].map(([id, name]) => [`${id} Nickname`, name])),
  maps: { maps: {} },
  // Upstream keeps translation keys in the data («<id> Name», «MOD_STOCK») and the texts in `items_en` / `items_ru`, as
  // tarkov-data-manager writes them.
  items: {
    items: GUNS.items,
    itemCategories: { ...GUNS.itemCategories, [FX_CATEGORY.foregrip]: { id: FX_CATEGORY.foregrip, name: `${FX_CATEGORY.foregrip} Name`, normalizedName: 'foregrip', parent: FX_CATEGORY.mod, children: [] } },
  },
  items_en: { [`${FX_CATEGORY.foregrip} Name`]: 'Foregrip', ...GUNS.names.en },
  items_ru: { [`${FX_CATEGORY.foregrip} Name`]: 'Тактическая рукоятка', ...GUNS.names.ru },
  hideout: {},
  barters: [],
  crafts: [],
}

// tarkov.help as it serves its task pages (src/data/tarkovHelpGunsmith.ts): a Next.js page whose server-components payload
// carries the task and its guide rendered to HTML — the build table (game item ids, trader portrait and loyalty level, or
// «Цена в барахолке») and the screenshot of the finished build.
const MINIO = 'https://minio.tarkov.help/production/img'
const helpRow = (id: string, short: string, seller: string) => `<tr class="bb-item"><td><div class="item-wrapper"><a href="/ru/item/x"><div class="item-img-container"><span class="item-shortname">${short}</span><img class="item-img" src="${MINIO}/items/${id}.png" alt="${short}"/></div></a></div></td><td class="bb-table-trader text-center"><div class="bb-table-td-container"><div class="bb-trader-wrapper">${seller}</div></div></td></tr>`
const helpTrader = (slug: string, level: number) => `<span class="bb-item-level"><img class="trader-unlock__level" src="${MINIO}/icons/loyalty/loyalty_${level}.svg" alt="wallet"/></span><div class="trader-wrapper"><img src="${MINIO}/traders/${slug}.png" height="84" width="84" alt=""/></div><div>10000 ₽</div>`
const helpGuide = `<p>Требования: эргономика выше 48, глушитель, тактическая рукоятка</p><p><table class="bb-table _items"><tbody>
${helpRow(FX.m4, 'M4A1', helpTrader('peacemaker', 1))}${helpRow(FX.suppressor, 'RC2', helpTrader('peacemaker', 3))}${helpRow(FX.holo, 'EXPS3', helpTrader('mechanic', 2))}
${helpRow(FX.stockMoe, 'MOE', helpTrader('mechanic', 1))}${helpRow(FX.foregripRvg, 'RVG', '<span class="bb-item-level"> </span><div>Цена в барахолке: 4000 ₽</div>')}
</tbody></table><br><div class="bb-image  " onclick="window.openLightbox('questLightbox', '${MINIO}/articles/m4-build.png')"><div class="bb-image__image"><img src="${MINIO}/articles/m4-build.png" alt="Оружейник" loading="lazy"/></div><div class="js-tooltip"><p class="bb-image__text"><span>Оружейник</span><div class="js-inner"><div class="bb-image__text-tooltip">Оружейник</div></div></p></div></div></p>`
const helpPage = (name: string, guide: string) => {
  const quest = { id: 110, name, seo_link: 'oruzhejnik-chast-7', guide: '$3c', guides: '', trader_slug: 'mechanic' }
  const parts = [`3c:T${new TextEncoder().encode(guide).length.toString(16)},${guide}`, `39:["$","div",null,{"quest":${JSON.stringify(quest)}}]\n`]
  return `<!DOCTYPE html><html><body>${parts.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join('')}</body></html>`
}
const HELP_PAGES: Record<string, string> = {
  '/ru/trader/mechanic/quests': `<a href="/ru/quest/oruzhejnik-chast-7"><span>Оружейник. M4A1</span></a><a href="/ru/quest/oruzhejnik-chast-99"><span>Другое</span></a>`,
  '/ru/quest/oruzhejnik-chast-7': helpPage('Оружейник. M4A1', helpGuide),
}
// The game's «Сборки оружия» screen with the build finished.
const BUILD_SCREEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1000"><rect width="1920" height="1000" fill="#0b0d0c"/><text x="960" y="70" fill="#e6ece7" font-family="sans-serif" font-size="44" text-anchor="middle">СБОРКИ ОРУЖИЯ</text><g fill="#4d5a50" stroke="#8c9a8f" stroke-width="4"><rect x="420" y="500" width="900" height="80" rx="10"/><rect x="1300" y="515" width="380" height="36" rx="8"/><rect x="900" y="570" width="70" height="170" rx="8"/><path d="M420 510 L260 480 L260 640 L420 590 Z"/><rect x="760" y="440" width="260" height="56" rx="8"/></g><g fill="#c9d2cb" font-family="sans-serif" font-size="26"><text x="40" y="700">ЭРГОНОМИКА 52</text><text x="40" y="745">ВЕРТ. ОТДАЧА 98</text><text x="40" y="790">ГОРИЗ. ОТДАЧА 181</text></g></svg>`

const RIFLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 200"><g fill="#4d5a50" stroke="#8c9a8f" stroke-width="2"><rect x="40" y="88" width="300" height="34" rx="6"/><rect x="330" y="96" width="150" height="14" rx="4"/><rect x="250" y="120" width="26" height="54" rx="4"/><path d="M40 92 L4 84 L4 140 L40 124 Z"/></g></svg>`
const TRADER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3b3a33"/><circle cx="32" cy="26" r="13" fill="#b49a7c"/><path d="M8 64 C10 44 54 44 56 64 Z" fill="#4c5a4a"/></svg>`
const itemIcon = (label: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="1" y="1" width="62" height="62" rx="4" fill="#1d2420" stroke="#56645a"/><path d="M12 40 L46 26 L52 30 L18 46 Z" fill="#8e9b91"/><circle cx="22" cy="40" r="5" fill="#5d6a60"/><text x="60" y="12" font-family="sans-serif" font-size="9" font-weight="700" fill="#e6ece7" text-anchor="end">${label.replace(/[<&]/g, '')}</text></svg>`
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="8" fill="#26302a" stroke="#56645a"/><path d="M14 40 L50 24" stroke="#a9b6ac" stroke-width="6" stroke-linecap="round"/></svg>`

/**
 * The mod data (src/arsenal/gunCatalog.ts) reads the item files again when a Gunsmith part opens: from now on the server
 * answers that it is still preparing them. The task catalog, loaded before, keeps its copy.
 */
async function takeModsDown(page: Page) {
  await page.route((url) => url.hostname === 'json.tarkov.dev' && /\/items$/.test(url.pathname), (route) => route.fulfill({ status: 503, json: { error: 'Данные ещё не подготовлены на сервере' } }))
}

async function openOverview(page: Page) {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'json.tarkov.dev') {
      const endpoint = url.pathname.split('/').pop() ?? ''
      return route.fulfill({ json: { data: catalog[endpoint] ?? {} } })
    }
    if (url.hostname === 'tarkov.help') {
      const html = HELP_PAGES[url.pathname]
      return route.fulfill({ status: html ? 200 : 404, contentType: 'text/html; charset=utf-8', headers: { 'access-control-allow-origin': '*' }, body: html ?? 'Not found' })
    }
    if (url.hostname === 'minio.tarkov.help') return route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: BUILD_SCREEN_SVG })
    // The wiki has no page here: tarkov.help covers the task (the wiki only fills tasks it lacks).
    if (url.hostname === 'escapefromtarkov.fandom.com') return route.fulfill({ json: { error: { code: 'missingtitle' } }, headers: { 'access-control-allow-origin': '*' } })
    if (url.hostname === 'assets.tarkov.dev') {
      // Each item its own picture, labelled with its short name like the game's inventory icons.
      const icon = /^\/(.+)-icon\.webp$/.exec(url.pathname)
      const label = icon ? decodeURIComponent(icon[1]) : ''
      return route.fulfill({ contentType: 'image/svg+xml', body: /trader/.test(url.pathname) ? TRADER_SVG : /512|preset|-grid/.test(url.pathname) ? RIFLE_SVG : icon ? itemIcon(SHORT_NAMES[label] ?? label) : ICON_SVG })
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
  for (const text of ['Эргономика', '≥ 48', 'Отдача', '≤ 200', 'Вместимость магазина', 'Эффективная дальность', 'Прочность']) await expect(details).toContainText(text)
  // The part of a category the task asks for is put in by the example build; no separate block names it (owner, 12.10.2026).
  await expect(details).not.toContainText('Деталь из категории')
  // The stats the part does not ask for (0 upstream) are not listed.
  for (const text of ['Ширина', 'Высота', 'Точность', 'Начальная скорость']) await expect(details).not.toContainText(text)
  // tarkov.help's finished build: the game's «Сборки оружия» screen, full screen on a click, closed by Escape.
  const buildImage = details.locator('.gs-build-image img')
  await expect(buildImage).toHaveAttribute('src', `${MINIO}/articles/m4-build.png`, { timeout: 30_000 })
  await expect(details).toContainText('Готовая сборка: tarkov.help')
  await details.locator('.gs-build-image').click()
  await expect(page.locator('.gs-lightbox img')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.gs-lightbox')).toHaveCount(0)
  // One block of modules: tarkov.help's table without the weapon, in its order.
  // Peacekeeper sells the suppressor from level III, which the player (character level 20, nothing proves more) has not got.
  const modules = details.locator('.gs-block', { hasText: 'Обязательные модули' })
  await expect(modules).toHaveCount(1)
  await expect(modules.locator('.gs-part strong')).toHaveText(['RC2', 'EXPS3', 'MOE', 'RVG'])
  const suppressorCard = modules.locator('.gs-part', { hasText: 'RC2' })
  // The cards hold only the picture, the name and the price; who sells it is in the hover window.
  await expect(modules.locator('.gs-trader')).toHaveCount(0)
  // Hovering a module: what can go instead. The suppressor is asked for by the task itself.
  const required = await hoverWindow(page, suppressorCard)
  await expect(required).toContainText('Задание требует именно этот модуль')
  await expect(required.locator('.gs-trader.is-locked .gs-trader-level')).toHaveText('III', { timeout: 30_000 })
  await expect(required).toContainText('Миротворец — уровень 3 (у вас 1)')
  const window = await hoverWindow(page, modules.locator('.gs-part', { hasText: 'MOE' }))
  await expect(window).toContainText('Можно поставить вместо')
  await expect(window.locator('li').first()).toBeVisible({ timeout: 30_000 })
  await expect(window).toContainText(/Приклад|stock/)
  // Each alternative with the build's stats it gives, all within the task's limits.
  await expect(window.locator('.gs-alt-values').first()).toContainText(/эрг\. \d+/)
  const shot = async (name: string, target = page.locator('main')) => {
    await target.screenshot({ path: testInfo.outputPath(name) })
    if (process.env.GUNSMITH_SCREENSHOT_DIR) await target.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/${name}` })
  }
  await shot('gunsmith-overview-ru.png', panel)
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-hover-ru.png` })
  await page.mouse.move(0, 0)

  await details.getByRole('link', { name: /Как собрать/ }).click()
  await expect(page.getByRole('heading', { name: 'Оружейник', level: 1 })).toBeVisible()
  // The page: the finished build and its modules; no «Как собрать · пример сборки» section any more (owner, 11.10.2026).
  await expect(page.locator('main .gs-build-image img')).toHaveAttribute('src', `${MINIO}/articles/m4-build.png`)
  await expect(page.locator('main .gs-block', { hasText: 'Обязательные модули' }).locator('.gs-part strong')).toHaveText(['RC2', 'EXPS3', 'MOE', 'RVG'])
  await expect(page.getByText('Как собрать · пример сборки')).toHaveCount(0)
  await expect(page.locator('main .gs-shop, main .gs-levels')).toHaveCount(0)
  await shot('gunsmith-page-ru.png')
})

test('«Оружейник»: tarkov.help’s traders and loyalty levels on every part, also without the mod data', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await openOverview(page)
  const panel = page.locator('.gunsmith-panel')
  await expect(panel).toBeVisible({ timeout: 45_000 })
  await takeModsDown(page)
  await panel.getByRole('button', { name: /Оружейник\. M4A1/ }).click()
  const details = panel.locator('.gunsmith-details')
  await expect(details.locator('.gs-block', { hasText: 'Обязательные модули' })).toBeVisible({ timeout: 30_000 })
  // Hovering a part shows who sells it and from which level, from tarkov.help: Peacekeeper III (locked: nothing proves it yet).
  await expect((await hoverWindow(page, details.locator('.gs-part', { hasText: 'RC2' }))).locator('.gs-trader.is-locked .gs-trader-level')).toHaveText('III')
  await expect((await hoverWindow(page, details.locator('.gs-part', { hasText: 'EXPS3' }))).locator('.gs-trader-level')).toHaveText('II')
  // tarkov.help's «Цена в барахолке»: the flea only.
  await expect(await hoverWindow(page, details.locator('.gs-part', { hasText: 'RVG' }))).toContainText('Продаётся только на барахолке')
  // The rest of tarkov.help's build in the same block.
  const stock = details.locator('.gs-block', { hasText: 'Обязательные модули' }).locator('.gs-part', { hasText: 'MOE' })
  const window = await hoverWindow(page, stock)
  await expect(window.locator('.gs-trader')).toHaveCount(1)
  await expect(window).toContainText('Механик — уровень 1')
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-hover-sellers-ru.png` })
  await page.mouse.move(0, 0)
  // The catalog's item by tarkov.help's game id: its picture and Russian name, no availability text.
  await expect(stock.locator('img').first()).toHaveAttribute('src', /MOE-icon/)
  await expect(details).not.toContainText('нет на барахолке')
  await panel.screenshot({ path: testInfo.outputPath('gunsmith-wiki-sellers-ru.png') })
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await panel.screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-wiki-sellers-ru.png` })

  // The Gunsmith page: the guide's table is here, so no button to the wiki.
  await details.getByRole('link', { name: /Как собрать/ }).click()
  await expect(page.getByRole('heading', { name: 'Оружейник', level: 1 })).toBeVisible()
  // On the page the card also carries the item's full Russian name from the catalog.
  await expect(page.locator('main .gs-block', { hasText: 'Обязательные модули' }).locator('.gs-part', { hasText: 'Приклад Magpul MOE для AR-15' })).toBeVisible()
  // Without the mod data the hover window says so plainly and offers to try again.
  const unchecked = await hoverWindow(page, page.locator('main .gs-part', { hasText: 'MOE' }))
  await expect(unchecked).toContainText('Данные модулей не загрузились — аналоги не проверены.')
  await expect(unchecked.getByRole('button', { name: 'Повторить' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Страница на Wiki/ })).toHaveCount(0)
  if (process.env.GUNSMITH_SCREENSHOT_DIR) await page.locator('main').screenshot({ path: `${process.env.GUNSMITH_SCREENSHOT_DIR}/gunsmith-wiki-page-ru.png` })
})
