import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AppDataset, RaidMode } from '../domain/types'
import { fetchTarkovCatalog } from '../data/tarkovJsonClient'
import { cleanDatasetText } from '../shared/questText'
import { translateUiText } from './uiEnglish'

const CYRILLIC = /[А-Яа-яЁё]/
/** Russian text we have no English source for (e.g. from the Russian wiki) is not shown in English mode. */
const englishOr = (text: string, fallback: string) => {
  const translated = translateUiText(text)
  return CYRILLIC.test(translated) ? fallback : translated
}
const englishWiki = (name: string) => `https://escapefromtarkov.fandom.com/wiki/${encodeURIComponent(name.replace(/ /g, '_'))}`

/**
 * English text for the catalog. Structure, ids, counts and progress always come from the Russian
 * dataset; only display text is replaced by id from the English tarkov.dev catalog, so switching
 * the language never changes which quests exist or how many are done.
 */
export function overlayEnglish(ru: AppDataset, en: AppDataset | undefined): AppDataset {
  if (!en) return ru
  const traders = new Map(en.traders.map((trader) => [trader.id, trader]))
  const traderName = new Map<string, string>()
  for (const trader of ru.traders) {
    const english = traders.get(trader.id)
    if (english?.name) traderName.set(trader.name, english.name)
  }
  const quests = new Map(en.quests.map((quest) => [quest.id, quest]))
  const items = new Map(en.items.map((item) => [item.id, item]))
  const maps = new Map(en.maps.map((map) => [map.id, map]))
  const markers = new Map(en.markers.map((marker) => [marker.id, marker]))
  const hideout = new Map(en.hideout.map((station) => [station.id, station]))
  return {
    ...ru,
    traders: ru.traders.map((trader) => {
      const english = traders.get(trader.id)
      return english ? { ...trader, name: english.name || trader.name, role: english.role || trader.role } : trader
    }),
    quests: ru.quests.map((quest) => {
      const english = quests.get(quest.id)
      const trader = traderName.get(quest.trader) ?? quest.trader
      const name = english?.name || quest.name
      const objectives = english?.objectives.length ? english.objectives : quest.objectives
      const summary = quest.kind === 'story'
        ? 'Story chapter: follow the stages below.'
        : objectives.map((objective) => translateUiText(objective)).filter((line) => !CYRILLIC.test(line)).slice(0, 3).join('; ')
      return {
        ...quest,
        trader,
        name,
        description: englishOr(english?.description || quest.description, summary || 'See the objectives below.'),
        objectives,
        rewards: english?.rewards.length ? english.rewards : quest.rewards,
        // Story stages parsed from the Russian wiki have no English source; curated ones are translated.
        stages: quest.stages?.map((stage, index) => ({ ...stage, title: englishOr(stage.title, `Stage ${index + 1} (see the wiki)`), description: stage.description ? englishOr(stage.description, '') : stage.description })),
        wikiLink: quest.wikiLink && !CYRILLIC.test(name) ? englishWiki(name) : quest.wikiLink,
      }
    }),
    items: ru.items.map((item) => {
      const english = items.get(item.id)
      return english ? { ...item, name: english.name || item.name, shortName: english.shortName || item.shortName, description: english.description || item.description } : item
    }),
    maps: ru.maps.map((map) => {
      const english = maps.get(map.id)
      return english ? { ...map, name: english.name || map.name } : map
    }),
    markers: ru.markers.map((marker) => {
      const english = markers.get(marker.id)
      return english ? { ...marker, title: english.title || marker.title, description: english.description || marker.description, meta: english.meta ?? marker.meta } : marker
    }),
    hideout: ru.hideout.map((station) => {
      const english = hideout.get(station.id)
      return english ? { ...station, name: english.name || station.name } : station
    }),
  }
}

/** Loads the English catalog only while the interface is in English. */
export function useEnglishOverlay(data: AppDataset, mode: RaidMode, locale: string, allowed = true) {
  const query = useQuery({
    queryKey: ['tarkov-companion-data-en', mode],
    queryFn: async () => cleanDatasetText(await fetchTarkovCatalog(mode, 'en')),
    enabled: allowed && locale === 'en',
    staleTime: 10 * 60_000,
    gcTime: 1000 * 60 * 60 * 24,
    retry: 1,
  })
  return useMemo(() => (locale === 'en' ? overlayEnglish(data, query.data) : data), [data, locale, query.data])
}
