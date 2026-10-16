import { describe, expect, it } from 'vitest'
import type { Quest, WeaponBuildRequirement } from '../domain/types'
import { fetchTarkovHelpGuides, helpNameKey, parseQuestIndex, parseQuestPage, rscText, withHelpGuides } from './tarkovHelpGunsmith'

// A tarkov.help task page as the site serves it: a Next.js page whose React Server Components payload carries the task
// (`"quest":{…}`) and its guide rendered to HTML in a text chunk (`3c:T<UTF-8 byte length in hex>,…`).
const MINIO = 'https://minio.tarkov.help/production/img'
const row = (id: string, short: string, seller: string) => `<tr class="bb-item">
  <td><div class="bb-item-wrapper"><div class="item-wrapper item-name-wrapper "><a href="/ru/item/${short}" class="item-wrapper-link">
    <div class="item-img-container"><span class="item-shortname">${short}</span><img class="item-img" src="${MINIO}/items/${id}.png" alt="${short}"/></div></a></div></div></td>
  <td class="bb-table-trader text-center"><div class="bb-table-td-container"><div class="bb-trader-wrapper">${seller}</div></div></td>
</tr>
<tr><td class="bb-item__name-row" colspan="2"><span class="item-name">${short} полное имя</span></td></tr>`
const trader = (slug: string, level: number, alt: string) => `<span class="bb-item-level"><img class="trader-unlock__level" src="${MINIO}/icons/loyalty/loyalty_${level}.svg" alt="wallet"/></span>
  <div class="trader-wrapper"><img src="${MINIO}/traders/${slug}.png" height="84" width="84" alt="${alt}"/></div><div>12345 ₽</div>`
const flea = `<span class="bb-item-level"> </span><div>Цена в барахолке: 158888 ₽ </div>`
const notSold = `<span class="bb-item-level"> </span><div>Нельзя купить</div>`
const table = (rows: string[]) => `<table class="bb-table _items"><thead class="bb-headlines"><tr><td>Предмет</td><td class="text-center">Торговец</td></tr></thead><tbody>${rows.join('')}</tbody></table>`
// The screenshot block, with the caption whose «bb-image__text-tooltip» class once made a parser swallow the next table.
const image = (file: string) => `<div class="bb-image  " onclick="window.openLightbox('questLightbox', '${MINIO}/articles/${file}')">
  <div class="bb-image__image"><img src="${MINIO}/articles/${file}" alt="Оружейник" loading="lazy"/></div>
  <div class="js-tooltip"><p class="bb-image__text"><span>Оружейник</span><div class="js-inner"><div class="bb-image__text-tooltip">Оружейник</div></div></p></div></div>`

const WEAPON_A = '5bfea6e90db834001b7347f3'
const WEAPON_B = '5e81c3cbac2bb513793cdc75'
const guideHtml = `<p>Требования: эргономика не ниже 35</p><p>${table([
  row('5ce69cbad7f00c00b61c5098', 'MBUS FS', trader('mechanic', 2, 'Механик')),
  row(WEAPON_A, 'M700', trader('jaeger', 4, 'Егерь')),
  row('5cde7afdd7f00c000d36b89d', 'MOD*X', trader('peacemaker', 4, 'Миротворец')),
  row('5c86592b2e2216000e69e77c', 'PM II', flea),
])}<br>${image('php38sbp70kknf39IeBjfp.png')}</p><p>${table([
  row(WEAPON_B, 'Glock', trader('peacemaker', 1, 'Миротворец')),
  row('5ef61964ec7f42238c31e0c1', 'Fischer', notSold),
])}<br>${image('phpmkfrbbqc9a943EHhJpH.png')}</p>`

function page(name: string, guide: string) {
  const chunk = `3c:T${Buffer.byteLength(guide, 'utf8').toString(16)},${guide}`
  const quest = { id: 117, name, seo_link: 'oruzhejnik-chast-21', guide: '$3c', guides: `<p>[itemTable=${WEAPON_A},5cde7afdd7f00c000d36b89d]</p>`, trader_slug: 'mechanic', game_modes: [{ code: 'regular', name: 'PVP' }] }
  const tree = `39:["$","div",null,{"children":[["$","$L3a",null,{"quest":${JSON.stringify(quest)}}]]}]\n`
  // The payload comes in several pushes; the text chunk sits between them.
  const pushes = [`1:"$Sreact.fragment"\n`, chunk, tree.slice(0, 40), tree.slice(40)]
  return `<!DOCTYPE html><html><body>${pushes.map((part) => `<script>self.__next_f.push(${JSON.stringify([1, part])})</script>`).join('')}</body></html>`
}

const INDEX = `<ul>
  <li><a class="quest-link" href="/ru/quest/oruzhejnik-chast-21"><span>Оружейник - Мастер. Часть 8</span></a></li>
  <li><a href="/ru/quest/oruzhejnik-chast-15"><span>Оружейник. АС &quot;Вал&quot;</span></a></li>
  <li><a href="/ru/item/not-a-quest">Предмет</a></li>
</ul>`

const build = (weaponId: string, partIds: string[] = []): WeaponBuildRequirement => ({ weaponId, partIds, attributes: [] })
const quest = (id: string, name: string, builds: WeaponBuildRequirement[]): Quest => ({
  id, name, trader: 'Механик', level: 40, kappa: false, description: '', objectives: [], rewards: [],
  objectiveDetails: builds.map((entry, index) => ({ id: `${id}-o${index}`, type: 'buildWeapon', description: '', count: 1, build: entry })),
})

describe('«Оружейник» builds from tarkov.help', () => {
  it('matches the game’s task names whatever the quotes, case or look-alike letters', () => {
    expect(helpNameKey('Оружейник. АС «Вал»')).toBe(helpNameKey('Оружейник. АС "Вал"'))
    expect(helpNameKey('Оружейник. М4A1')).toBe(helpNameKey('ОРУЖЕЙНИК. M4А1'))
    expect(helpNameKey('Оружейник - Мастер. Часть 1')).not.toBe(helpNameKey('Оружейник - Мастер. Часть 11'))
  })

  it('reads a text chunk of the payload by its UTF-8 byte length (Cyrillic is 2 bytes a letter)', () => {
    const text = 'Привет, <b>мир</b>'
    expect(rscText(`0:"x"\n3c:T${Buffer.byteLength(text, 'utf8').toString(16)},${text}39:["$"]`, '$3c')).toBe(text)
    expect(rscText('0:"x"', '$3c')).toBeUndefined()
  })

  it('reads every build of a page: items in order, who sells each, the screenshot after each table', () => {
    const parsed = parseQuestPage(page('Оружейник - Мастер. Часть 8', guideHtml))
    expect(parsed?.name).toBe('Оружейник - Мастер. Часть 8')
    expect(parsed?.tables).toHaveLength(2)
    const [first, second] = parsed!.tables
    expect(first.itemIds).toEqual(['5ce69cbad7f00c00b61c5098', WEAPON_A, '5cde7afdd7f00c000d36b89d', '5c86592b2e2216000e69e77c'])
    expect(first.sellers).toEqual({
      '5ce69cbad7f00c00b61c5098': { trader: 'mechanic', level: 2 },
      [WEAPON_A]: { trader: 'jaeger', level: 4 },
      // tarkov.help's «peacemaker» is tarkov.dev's «peacekeeper».
      '5cde7afdd7f00c000d36b89d': { trader: 'peacekeeper', level: 4 },
      '5c86592b2e2216000e69e77c': { fleaOnly: true },
    })
    expect(first.names['5cde7afdd7f00c000d36b89d']).toBe('MOD*X')
    expect(first.image).toBe(`${MINIO}/articles/php38sbp70kknf39IeBjfp.png`)
    expect(second.itemIds).toEqual([WEAPON_B, '5ef61964ec7f42238c31e0c1'])
    expect(second.sellers['5ef61964ec7f42238c31e0c1']).toEqual({ notSold: true })
    expect(second.image).toBe(`${MINIO}/articles/phpmkfrbbqc9a943EHhJpH.png`)
  })

  it('falls back to the raw [itemTable=…] list when the rendered guide is missing', () => {
    const parsed = parseQuestPage(page('Оружейник - Мастер. Часть 8', '<p>нет таблицы</p>'))
    expect(parsed?.tables).toEqual([{ itemIds: [WEAPON_A, '5cde7afdd7f00c000d36b89d'], sellers: {}, names: {} }])
  })

  it('reads a trader’s task list', () => {
    expect(parseQuestIndex(INDEX)).toEqual([
      { slug: 'oruzhejnik-chast-21', name: 'Оружейник - Мастер. Часть 8' },
      { slug: 'oruzhejnik-chast-15', name: 'Оружейник. АС "Вал"' },
    ])
  })

  it('gives each weapon of a task its own table; the weapons are not parts; parts the task names are required', () => {
    const tables = parseQuestPage(page('Оружейник - Мастер. Часть 8', guideHtml))!.tables
    const guides = new Map([['master-8', { url: 'https://tarkov.help/ru/quest/oruzhejnik-chast-21', name: 'Оружейник - Мастер. Часть 8', tables }]])
    // The task lists its weapons in the other order than the page: matched by the weapon each table holds.
    const [result] = withHelpGuides([quest('master-8', 'Оружейник - Мастер. Часть 8', [build(WEAPON_B), build(WEAPON_A, ['5cde7afdd7f00c000d36b89d'])])], guides, () => false)
    const [glock, rifle] = result.objectiveDetails!.map((objective) => objective.build!)
    expect(glock.guide).toEqual({
      source: 'tarkov.help', url: 'https://tarkov.help/ru/quest/oruzhejnik-chast-21', image: `${MINIO}/articles/phpmkfrbbqc9a943EHhJpH.png`,
      parts: [{ itemId: '5ef61964ec7f42238c31e0c1', name: 'Fischer', sellers: [], notSold: true }],
    })
    expect(rifle.guide?.image).toBe(`${MINIO}/articles/php38sbp70kknf39IeBjfp.png`)
    expect(rifle.guide?.parts.map((part) => [part.name, part.required ?? false, part.sellers, part.fleaOnly ?? false])).toEqual([
      ['MBUS FS', false, [{ trader: 'mechanic', level: 2 }], false],
      ['MOD*X', true, [{ trader: 'peacekeeper', level: 4 }], false],
      ['PM II', false, [], true],
    ])
    // Another weapon in a table (a preset of it) is not a part either.
    const [presetOnly] = withHelpGuides([quest('master-8', 'x', [build(WEAPON_A)])], guides, (id) => id === '5ce69cbad7f00c00b61c5098')
    expect(presetOnly.objectiveDetails![0].build!.guide!.parts.map((part) => part.name)).toEqual(['MOD*X', 'PM II'])
  })

  it('finds the pages through the trader lists, by the task’s Russian name, and keeps them for a while', async () => {
    const asked: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      asked.push(url)
      if (url.endsWith('/ru/trader/mechanic/quests')) return new Response(INDEX)
      if (url.endsWith('/ru/quest/oruzhejnik-chast-21')) return new Response(page('Оружейник - Мастер. Часть 8', guideHtml))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const tasks = [{ id: 'master-8', name: 'Оружейник - Мастер. Часть 8', trader: 'mechanic' }, { id: 'unknown', name: 'Нет такого', trader: 'mechanic' }]
    const found = await fetchTarkovHelpGuides(tasks, fetcher)
    expect([...found.keys()]).toEqual(['master-8'])
    expect(found.get('master-8')?.tables).toHaveLength(2)
    expect(asked).toEqual(['https://tarkov.help/ru/trader/mechanic/quests', 'https://tarkov.help/ru/quest/oruzhejnik-chast-21'])
    await fetchTarkovHelpGuides(tasks, fetcher)
    expect(asked).toHaveLength(2)
  })
})
