import { describe, expect, it } from 'vitest'
import type { Quest } from '../domain/types'
import { englishItemNames, englishItemResolver, fetchWikiBuildTables, parseWikiBuildTable, wikiPageTitle, withWikiBuilds } from './wikiGunsmith'

const a = (title: string, text = title) => `<a href="/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}" title="${title.replace(/"/g, '&quot;')}">${text}</a>`
const icon = (title: string) => `<a href="/wiki/${title.replace(/ /g, '_')}" class="image" title="${title}"><img alt="${title}" src="x.png"></a>`

// «Ад на земле. Часть 1» (Hell on Earth - Part 1): the classic «Related Quest Items» table with a «Requirement» column.
const HELL_ON_EARTH = `<div class="mw-parser-output"><p>Intro ${a('Prapor')}</p>
<table class="wikitable" style="text-align:center;"><tbody>
<tr><th colspan="5">Related Quest Items</th></tr>
<tr><th>Icon</th><th>Item name</th><th>Amount</th><th>Requirement</th><th>Notes</th></tr>
<tr><td>${icon('MP-43-1C 12ga double-barrel shotgun')}</td><td>${a('MP-43-1C 12ga double-barrel shotgun')}</td><td>1</td><td>Has to be modified and handed over</td><td>Can be purchased from ${a('Jaeger')} LL1.</td></tr>
<tr><td>${icon('MP-43-1C 12ga 510mm barrel')}</td><td>${a('MP-43-1C 12ga 510mm barrel')}</td><td>1</td><td>Has to be installed on the shotgun</td><td>Can be purchased from ${a('Jaeger')} LL1.</td></tr>
</tbody></table></div>`

// «Оружейник - Мастер. Часть 1»: icon | item | trader | level; two traders split by a line, one trader with two levels.
const MASTER = `<table class="wikitable"><tbody>
<tr><th colspan="4">Related Quest Items</th></tr>
<tr><th>Icon</th><th>Item</th><th>Trader</th><th>Loyalty</th></tr>
<tr><td>${icon('HK 416A5 5.56x45 assault rifle')}</td><td>${a('HK 416A5 5.56x45 assault rifle')}</td><td>${a('Peacekeeper')}</td><td>LL2</td></tr>
<tr><td>${icon('AR-15 Magpul MOE pistol grip (FDE)')}</td><td>${a('AR-15 Magpul MOE pistol grip (FDE)')}</td><td>${a('Peacekeeper')}</td><td>LL4</td></tr>
<tr><td>${icon('HK 416 5.56x45 11 inch barrel')}</td><td>${a('HK 416 5.56x45 11 inch barrel')}</td><td>${a('Peacekeeper')}<hr>${a('Mechanic')}</td><td>LL2 (Barter)<hr>LL3</td></tr>
<tr><td>${icon('HK 416 Midwest Industries 9 inch M-LOK handguard')}</td><td>${a('HK 416 Midwest Industries 9 inch M-LOK handguard')}</td><td>${a('Peacekeeper')}</td><td>LL2 (Barter)<br>LL3</td></tr>
<tr><td rowspan="2">${icon('EOTech EXPS3-0 holographic sight (Tan)')}</td><td rowspan="2">${a('EOTech EXPS3-0 holographic sight (Tan)')}</td><td>${a('Mechanic')}</td><td>LL4</td></tr>
<tr><td>${a('Ref')}</td><td>LL3</td></tr>
</tbody></table>`

describe('«Оружейник»: parts from the task’s wiki page', () => {
  it('reads the English wiki page title of tarkov.dev’s link, not the Russian wiki', () => {
    expect(wikiPageTitle('https://escapefromtarkov.fandom.com/wiki/Gunsmith_-_Part_1')).toBe('Gunsmith - Part 1')
    expect(wikiPageTitle('https://escapefromtarkov.fandom.com/wiki/Hell_on_Earth_-_Part_1')).toBe('Hell on Earth - Part 1')
    expect(wikiPageTitle('https://escapefromtarkov.fandom.com/ru/wiki/%D0%9E')).toBeUndefined()
    expect(wikiPageTitle(undefined)).toBeUndefined()
  })

  it('reads «Related Quest Items»: the weapon to hand over, the part that has to be installed, who sells it', () => {
    expect(parseWikiBuildTable(HELL_ON_EARTH)).toEqual([
      { name: 'MP-43-1C 12ga double-barrel shotgun', handover: true, sellers: [{ trader: 'jaeger', level: 1 }] },
      { name: 'MP-43-1C 12ga 510mm barrel', required: true, sellers: [{ trader: 'jaeger', level: 1 }] },
    ])
  })

  it('pairs traders with their levels, barters included, also across split cells and rows', () => {
    const rows = parseWikiBuildTable(MASTER)
    expect(rows.map((row) => row.name)).toEqual([
      'HK 416A5 5.56x45 assault rifle', 'AR-15 Magpul MOE pistol grip (FDE)', 'HK 416 5.56x45 11 inch barrel',
      'HK 416 Midwest Industries 9 inch M-LOK handguard', 'EOTech EXPS3-0 holographic sight (Tan)',
    ])
    expect(rows[1].sellers).toEqual([{ trader: 'peacekeeper', level: 4 }])
    expect(rows[2].sellers).toEqual([{ trader: 'peacekeeper', level: 2, barter: true }, { trader: 'mechanic', level: 3 }])
    expect(rows[3].sellers).toEqual([{ trader: 'peacekeeper', level: 2, barter: true }, { trader: 'peacekeeper', level: 3 }])
    expect(rows[4].sellers).toEqual([{ trader: 'mechanic', level: 4 }, { trader: 'ref', level: 3 }])
    expect(rows.some((row) => row.required)).toBe(false)
  })

  it('reads barters written in words in the notes', () => {
    const page = `<table class="wikitable"><tr><th colspan="3">Related Quest Items</th></tr>
<tr><td>${a('Magpul M-LOK 4.1 inch rail')}</td><td>1</td><td>Can be purchased from ${a('Mechanic')} LL1 or bartered from ${a('Mechanic')} LL1.</td></tr></table>`
    expect(parseWikiBuildTable(page)[0].sellers).toEqual([{ trader: 'mechanic', level: 1 }, { trader: 'mechanic', level: 1, barter: true }])
  })

  it('finds the catalog items by English name or short name and lays the parts over the task’s build', () => {
    const resolve = englishItemResolver([
      { id: 'mp43', name: 'MP-43-1C 12ga double-barrel shotgun', shortName: 'MP-43-1C' },
      { id: 'b510', name: 'MP-43-1C 12ga 510mm barrel', shortName: 'MP-43 510mm' },
      { id: 'moe', name: 'AR-15 Magpul MOE pistol grip (FDE)', shortName: 'MOE AR15' },
      { id: 'moe-black', name: 'AR-15 Magpul MOE pistol grip (Black)', shortName: 'MOE AR15' },
    ])
    expect(resolve('MP-43-1C 12ga 510mm barrel')).toBe('b510')
    expect(resolve('MP-43 510mm')).toBe('b510')
    // Two items with the same short name: not guessed.
    expect(resolve('MOE AR15')).toBeUndefined()
    const quest: Quest = {
      id: 'hell-1', name: 'Ад на земле. Часть 1', trader: 'Прапор', level: 12, kappa: false, description: '', objectives: [], rewards: [],
      wikiLink: 'https://escapefromtarkov.fandom.com/wiki/Hell_on_Earth_-_Part_1',
      objectiveDetails: [{ id: 'o', type: 'buildWeapon', description: '', count: 1, build: { weaponId: 'mp43', partIds: [], attributes: [] } }],
    }
    const [result] = withWikiBuilds([quest], new Map([['Hell on Earth - Part 1', parseWikiBuildTable(HELL_ON_EARTH)]]), resolve)
    expect(result.objectiveDetails?.[0].build).toEqual({
      weaponId: 'mp43', partIds: ['b510'], attributes: [],
      guide: { source: 'wiki', url: 'https://escapefromtarkov.fandom.com/wiki/Hell_on_Earth_-_Part_1', parts: [{ itemId: 'b510', name: 'MP-43-1C 12ga 510mm barrel', required: true, sellers: [{ trader: 'jaeger', level: 1 }] }] },
    })
  })

  it('takes the English names from upstream’s dictionary (the data holds translation keys)', () => {
    const raw = [
      { id: 'mp5sd-upper', name: 'mp5sd-upper Name', shortName: 'mp5sd-upper ShortName' },
      { id: 'ncstar', name: 'ncstar Name', shortName: 'ncstar ShortName' },
      { id: 'plain', name: 'Plain name already', shortName: 'PLN' },
    ]
    const english = { 'mp5sd-upper Name': 'HK MP5SD 9x19 upper receiver', 'mp5sd-upper ShortName': 'MP5SD upper', 'ncstar Name': 'NcSTAR Tactical blue laser LAM-Module', 'ncstar ShortName': 'NcSTAR' }
    const resolve = englishItemResolver(englishItemNames(raw, english))
    expect(resolve('HK MP5SD 9x19 upper receiver')).toBe('mp5sd-upper')
    // Case and punctuation do not matter; a name the wiki shortens is still found when only one item has it.
    expect(resolve('NcSTAR Tactical Blue Laser LAM-Module')).toBe('ncstar')
    expect(resolve('NcSTAR Tactical blue laser')).toBe('ncstar')
    expect(resolve('Plain name already')).toBe('plain')
  })

  it('asks the wiki API for the rendered page and keeps going when a page fails', async () => {
    const asked: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = new URL(String(input))
      const page = url.searchParams.get('page') ?? ''
      asked.push(page)
      expect(url.origin + url.pathname).toBe('https://escapefromtarkov.fandom.com/api.php')
      expect(url.searchParams.get('action')).toBe('parse')
      if (page === 'Broken page') return new Response('nope', { status: 500 })
      return Response.json({ parse: { title: page, text: page === 'Wiki test A' ? HELL_ON_EARTH : MASTER } })
    }) as typeof fetch
    const tables = await fetchWikiBuildTables(['Wiki test A', 'Broken page', 'Wiki test B'], fetcher)
    expect([...tables.keys()].sort()).toEqual(['Wiki test A', 'Wiki test B'])
    expect(asked.sort()).toEqual(['Broken page', 'Wiki test A', 'Wiki test B'])
    // Kept for a while: asked again only after the cache runs out.
    await fetchWikiBuildTables(['Wiki test A'], fetcher)
    expect(asked.filter((page) => page === 'Wiki test A')).toHaveLength(1)
  })
})
