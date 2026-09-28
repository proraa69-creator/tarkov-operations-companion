import { describe, expect, it } from 'vitest'
import { isWikiMapHost, wikiMapUrl } from './wikiMaps'

describe('wiki interactive map urls', () => {
  it('opens every Fandom map page from the Карта namespace', () => {
    expect(wikiMapUrl('shoreline')).toBe(`https://escapefromtarkov.fandom.com/ru/wiki/${encodeURIComponent('Карта:Берег')}`)
    expect(wikiMapUrl('customs')).toContain(encodeURIComponent('Карта:Таможня'))
    expect(wikiMapUrl('icebreaker')).toContain(encodeURIComponent('Карта:Ледокол'))
    expect(wikiMapUrl('the-labyrinth')).toContain(encodeURIComponent('Карта:Лабиринт'))
    expect(wikiMapUrl('unknown-map')).toBeUndefined()
  })

  it('deep-links a marker so the wiki map can focus a quest point', () => {
    expect(wikiMapUrl('reserve', '42')).toBe(`https://escapefromtarkov.fandom.com/ru/wiki/${encodeURIComponent('Карта:Резерв')}?marker=42`)
  })

  it('allows Fandom and Wikia hosts inside the desktop webview', () => {
    expect(isWikiMapHost('https://escapefromtarkov.fandom.com/ru/wiki/Карта:Берег')).toBe(true)
    expect(isWikiMapHost('https://static.wikia.nocookie.net/map.png')).toBe(true)
    expect(isWikiMapHost('https://tarkov.dev/map/customs')).toBe(false)
  })
})
