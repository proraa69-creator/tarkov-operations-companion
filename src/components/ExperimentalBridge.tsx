import { addNotification } from '../notifications/notificationCenter'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useQueryClient } from '@tanstack/react-query'
import { refreshLivePrices, useLivePrices, withLivePrice } from '../data/livePrices'
import { useAppState } from '../state/AppState'
import { createItemMatcher, matchNearest } from '../overlay/itemMatch'
import { createTooltipMatcher, foldTooltipText, type ItemNameVariant, type TooltipCandidate, type TooltipMatcher } from '../overlay/tooltipMatch'
import { createLookupMemory } from '../overlay/tooltipLookup'
import { candidateDistance, decideByPicture, decodeIcon, iconSignature, isItemIconUrl, PICTURE_MATCH, type PictureAnswer, type PictureCandidate, type PictureCandidatesAnswer, type PictureQuery } from '../overlay/iconMatch'
import type { PictureSignature } from '../overlay/iconSignature'
import { loadItemNameVariants } from '../overlay/itemNames'
import { describeItem } from '../overlay/itemInfo'
import { isKappaBadgeMissingOnly } from '../kappa/kappaBadgeSetting'
import type { ItemOverlayInfo, ItemOverlayPayload } from '../overlay/types'
import type { Item } from '../domain/types'
import { setRecognisedItem } from '../items/recognisedItem'
import { collectorEntries, loadCollected, scanForCollectorItems } from '../kappa/collector'
import { computeKeepList, keepBadge, type KeepRow } from '../raidprep/keepList'
import { applyHideoutModules } from '../hideout/hideoutModules'
import { useHideoutModules } from '../hideout/hideoutModulesStore'
import { mateNamesFor, mateNeedsItem, useMateNeedsRefresh } from '../squad/mateNeeds'
import { featureEnabled } from '../app/archivedFeatures'
import { setFleaCatalog } from '../data/screenFleaPrices'
import { notificationOn } from '../notifications/notificationKinds'
import type { GameNames } from '../data/gameNames'
import { noteGameLanguage, useGameNames } from '../data/gameNamesLoader'
import { useLocale } from '../i18n/LocaleProvider'
import { syncGameLanguage } from '../import/gameLanguageSync'

/**
 * The item names of the tooltip matcher: the Russian and English ones, and the game's own when it runs in German, Japanese
 * or Chinese (src/data/gameNames.ts) — the game's tooltip shows its language's name.
 */
function withGameItemNames(variants: Map<string, ItemNameVariant[]> | null, names: GameNames | null): ReadonlyMap<string, ItemNameVariant[]> | undefined {
  const own = names?.items
  if (!own?.size) return variants ?? undefined
  const merged = new Map(variants ?? [])
  for (const [id, names] of own) merged.set(id, [...(merged.get(id) ?? []), names])
  return merged
}

/** Readings the second attempt found an item for (one list for the app, see createLookupMemory). */
const lookupMemory = createLookupMemory(() => window.localStorage, foldTooltipText)
/** Icon signatures by item id for the picture check, kept while the app runs. */
const iconSignatures = new Map<string, PictureSignature>()
const ICON_SIGNATURES_KEPT = 400

/** Rankings of recent readings by matcher: one lookup's second attempt asks for the same readings several times. */
const rankings = new WeakMap<TooltipMatcher, Map<string, TooltipCandidate[]>>()
function rankOf(matcher: TooltipMatcher, text: string) {
  let cache = rankings.get(matcher)
  if (!cache) rankings.set(matcher, cache = new Map())
  let ranked = cache.get(text)
  if (!ranked) {
    ranked = matcher.rank(text, PICTURE_MATCH.candidates)
    if (cache.size >= 64) cache.delete(cache.keys().next().value!)
    cache.set(text, ranked)
  }
  return ranked
}

/** The items the readings could name, best first (each item with its best score over the readings). */
function rankReadings(matcher: TooltipMatcher, texts: string[]) {
  const best = new Map<string, TooltipCandidate>()
  for (const text of texts) {
    for (const candidate of rankOf(matcher, text)) {
      if ((best.get(candidate.item.id)?.score ?? -Infinity) < candidate.score) best.set(candidate.item.id, candidate)
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, PICTURE_MATCH.candidates)
}

/**
 * The text candidates plus the closest pictures of the whole catalog (the picture index), each of those with how well
 * the readings name it (0 when not among the names they suggest at all): the picture then chooses only among items the
 * text finds plausible too (decideByPicture), so a bad reading of a long name still finds its item by its picture.
 */
function withNearby(matcher: TooltipMatcher, items: Map<string, Item>, ranked: TooltipCandidate[], texts: string[], nearby: string[]) {
  const known = new Set(ranked.map(({ item }) => item.id))
  const extra = nearby.filter((id) => !known.has(id) && items.has(id))
  if (!extra.length) return ranked
  const scores = new Map<string, number>()
  for (const text of texts) {
    for (const candidate of matcher.rank(text, NEARBY_RANK)) scores.set(candidate.item.id, Math.max(scores.get(candidate.item.id) ?? 0, candidate.score))
  }
  return [...ranked, ...extra.map((id) => ({ item: items.get(id)!, score: scores.get(id) ?? 0 }))]
}
/** How deep the readings' ranking is searched for the score of a picture candidate. */
const NEARBY_RANK = 120

/** Why an item's picture cannot be compared, if it cannot. */
function pictureObstacle(item: Item): 'weapon' | 'no-size' | 'no-icon' | null {
  if (item.types?.includes('gun')) return 'weapon'
  if (!item.width || !item.height) return 'no-size'
  return isItemIconUrl(item.iconUrl) ? null : 'no-icon'
}

/** Whether the reading still names the item among its likely ones (at least this well). */
const readsLike = (matcher: TooltipMatcher, text: string, id: string, score = -Infinity) => rankOf(matcher, text).some((candidate) => candidate.item.id === id && candidate.score >= score)

/** Readings found only by the second attempt are remembered as the item — those that read like its name. */
function rememberReadings(matcher: TooltipMatcher, texts: string[], item: Item) {
  lookupMemory.remember(texts, item.id, (text) => readsLike(matcher, text, item.id, PICTURE_MATCH.memoryText))
}

/** The picture check of the second attempt (src/overlay/iconMatch.ts): which candidate the item under the cursor is. */
async function checkPicture(matcher: TooltipMatcher, items: Map<string, Item>, input: PictureQuery) {
  // Signatures from the picture index need no download.
  for (const [id, signature] of Object.entries(input.signatures ?? {})) {
    if (iconSignatures.has(id)) continue
    if (iconSignatures.size >= ICON_SIGNATURES_KEPT) iconSignatures.delete(iconSignatures.keys().next().value!)
    iconSignatures.set(id, signature)
  }
  const ranked = withNearby(matcher, items, rankReadings(matcher, input.texts), input.texts, input.nearby ?? [])
  // New icons are decoded together (off the main thread in the browser), then kept by item id.
  await Promise.all(ranked.map(async ({ item }) => {
    const bytes = input.icons[item.id]
    if (pictureObstacle(item) || iconSignatures.has(item.id) || !bytes) return
    const pixels = await decodeIcon(bytes)
    if (!pixels) return
    if (iconSignatures.size >= ICON_SIGNATURES_KEPT) iconSignatures.delete(iconSignatures.keys().next().value!)
    iconSignatures.set(item.id, iconSignature(pixels, item.width!, item.height!))
  }))
  const candidates: PictureCandidate[] = []
  const report: PictureAnswer['candidates'] = []
  for (const { item, score } of ranked) {
    const obstacle = pictureObstacle(item)
    const signature = obstacle ? undefined : iconSignatures.get(item.id)
    const distance = obstacle ?? (signature ? candidateDistance(input.screen, { cols: item.width!, rows: item.height! }, signature) ?? 'size' : 'no-icon')
    candidates.push({ id: item.id, text: score, distance })
    report.push({ itemId: item.id, name: item.name, text: Number(score.toFixed(3)), ...(typeof distance === 'object'
      ? { distance: Number(distance.distance.toFixed(3)), shape: Number(distance.shape.toFixed(3)), tint: Number(distance.tint.toFixed(3)), known: Number(distance.known.toFixed(2)) }
      : { skipped: distance }) })
  }
  const verdict = decideByPicture(candidates)
  return { item: verdict.id ? items.get(verdict.id) ?? null : null, reason: verdict.reason, report }
}

/**
 * Answers the item lookup of the main process from the main window, which already holds the catalog and quest progress:
 * the item key («Ж») asks what the item under the cursor is and what it is needed for. The answer comes back as
 * `experimental:item` and becomes the card on «Карты» under «Вид» (items/recognisedItem.ts); nothing is drawn over the
 * game (owner, 15.10.2026).
 */
export function ExperimentalBridge() {
  const { data } = useTarkovData()
  const state = useAppState()
  const matcher = useMemo(() => createItemMatcher(data.items), [data.items])
  // The game's tooltip shows the name in the game's language: match against Russian and English names.
  const [nameVariants, setNameVariants] = useState<Map<string, ItemNameVariant[]> | null>(null)
  useEffect(() => {
    if (!window.tarkovDesktop?.experimental) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = () => {
      void loadItemNameVariants().then((names) => { if (active) setNameVariants(names) }).catch(() => {
        if (active) timer = setTimeout(load, 30_000)
      })
    }
    timer = setTimeout(load, 3000)
    return () => { active = false; clearTimeout(timer) }
  }, [])
  // A German, Japanese or Chinese game shows its own names (src/data/gameNames.ts): matched beside the Russian and English.
  const currentGameNames = useGameNames()
  const alternates = useMemo(() => withGameItemNames(nameVariants, currentGameNames), [nameVariants, currentGameNames])
  // The game's language is the app's (owner, 25.11.2026): told to the main process's readers at start and on every change,
  // and its names load at once (src/import/gameLanguageSync.ts).
  const { language } = useLocale()
  useEffect(() => { void syncGameLanguage(language) }, [language])
  const tooltipMatcher = useMemo(() => createTooltipMatcher(data.items, alternates), [data.items, alternates])
  const itemsById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  // «Что не продавать» of the selected mode, for the badge on the item card (computed once per progress change).
  const progressNow = state.activeProfile.modes[state.raidMode]
  const modules = useHideoutModules()
  // Archived with the «Что не продавать» page: the item card shows only «Каппа» and «MATE» then.
  const keepRows = useMemo(() => {
    if (!window.tarkovDesktop?.experimental || !featureEnabled('keepItems')) return new Map<string, KeepRow>()
    const rows = computeKeepList({ quests: data.quests, hideout: applyHideoutModules(data.hideout, state.raidMode, modules), items: data.items, progress: progressNow, collectorCollected: loadCollected(state.raidMode) })
    return new Map(rows.map((row) => [row.item.id, row]))
  }, [data.quests, data.hideout, data.items, progressNow, state.raidMode, modules])
  // The item card's flea price (owner, 26.11.2026: «я по кнопке уже нажимаю в следующий раз, и уже должна быть новая
  // цена»): this player's own read on his screen at once, and our server's minute prices, asked for again on its looks
  // when older than half a minute — not every half minute all the time (a page of prices does that while it is open).
  const queryClient = useQueryClient()
  const live = useLivePrices(state.raidMode, false)
  const latest = useRef({ data, state, matcher, tooltipMatcher, itemsById, keepRows, live, queryClient })
  // Friends' / squad mates' needed items for the «MATE» badge (refreshed periodically and on raid start).
  useMateNeedsRefresh(state.raidMode, data.quests)

  useEffect(() => {
    latest.current = { data, state, matcher, tooltipMatcher, itemsById, keepRows, live, queryClient }
  })

  // The flea's rows read on the player's screen name their items by the item card's matcher (src/data/screenFleaPrices.ts).
  useEffect(() => {
    setFleaCatalog({ match: (name) => tooltipMatcher(name) })
    return () => setFleaCatalog(null)
  }, [tooltipMatcher])

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    return api.onQuery((query) => {
      const { data, state, matcher, tooltipMatcher, itemsById, keepRows, live, queryClient } = latest.current
      const progress = state.activeProfile.modes[state.raidMode]
      // The next look has the server's prices of now.
      refreshLivePrices(queryClient, state.raidMode)
      // Two independent parts of the card: the keep badge («Что не продавать») and who of the friends / squad needs the item.
      const card = (item: Item, source?: ItemOverlayInfo['source']): ItemOverlayPayload => ({
        // «Значок «Каппа» только на недостающих» (Kappa page): no Kappa badge on items already checked in this mode.
        ...describeItem(withLivePrice(item, state.raidMode, live), data.quests, progress, state.raidMode, keepBadge(keepRows.get(item.id)), isKappaBadgeMissingOnly() ? loadCollected(state.raidMode) : undefined),
        ...(mateNeedsItem(state.raidMode, item.id) ? { mate: true, mateNames: mateNamesFor(state.raidMode, item.id) ?? [] } : {}),
        ...(source ? { source } : {}),
      })
      if (query.kind === 'item') {
        const { input } = query
        if (input.language) noteGameLanguage(input.language)
        let source: ItemOverlayInfo['source']
        let item: Item | null | undefined
        if (input.test) item = data.items.find((entry) => (entry.fleaPrice ?? 0) > 0 && data.quests.some((quest) => quest.requiredItems?.includes(entry.id)))
        else if (input.tooltip) {
          // A reading the second attempt once found an item for names it at once (if the item still fits it).
          const remembered = lookupMemory.recall(input.text, (id) => itemsById.has(id) && readsLike(tooltipMatcher, input.text, id))
          // One name in the box: no loose fallback — a wrong item is worse than «not found».
          item = remembered ? itemsById.get(remembered) : tooltipMatcher(input.text)
          source = remembered ? 'memory' : input.remember ? 'retry' : undefined
          if (item && !remembered && input.remember?.length) rememberReadings(tooltipMatcher, input.remember, item)
        } else item = (input.lines?.length ? matchNearest(matcher, input.lines) : null) ?? matcher(input.text)
        void api.answer(query.id, item ? card(item, source) : { state: 'not-found', text: input.text } satisfies ItemOverlayPayload)
        return
      }
      if (query.kind === 'item-id') {
        const item = itemsById.get(query.input.id)
        void api.answer(query.id, item ? card(item, 'picture') : { state: 'not-found' } satisfies ItemOverlayPayload)
        return
      }
      if (query.kind === 'item-candidates') {
        const candidates = rankReadings(tooltipMatcher, query.input.texts).map(({ item }) => ({
          itemId: item.id,
          known: iconSignatures.has(item.id),
          ...(pictureObstacle(item) ? {} : { iconUrl: item.iconUrl }),
        }))
        void api.answer(query.id, { candidates } satisfies PictureCandidatesAnswer)
        return
      }
      if (query.kind === 'item-picture') {
        const { input } = query
        void checkPicture(tooltipMatcher, itemsById, input).then(({ item, reason, report }) => {
          // Found only by its picture: the readings are remembered as this item.
          if (item) rememberReadings(tooltipMatcher, input.texts, item)
          const answer: PictureAnswer<ItemOverlayPayload> = { payload: item ? card(item, 'picture') : { state: 'not-found', text: input.texts[0] ?? '' }, reason, candidates: report }
          return api.answer(query.id, answer)
        }).catch(() => api.answer(query.id, null))
      }
    })
  }, [])

  // The lookup's «reading…», card or «not recognised»: kept for «Карты» whatever page is open (no window over the game).
  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api?.onItem) return
    return api.onItem((payload) => setRecognisedItem(payload, { mode: latest.current.state.raidMode, from: 'pc' }))
  }, [])

  useEffect(() => {
    const api = window.tarkovDesktop?.experimental
    if (!api) return
    let scanning = false
    return api.onCollectorScan(() => {
      if (scanning) return
      const { data, state } = latest.current
      // Pressed in the game, so the system message does not come: what the scan found waits in «Уведомления».
      const notify = (message: string, keep = true) => {
        // switched off in «Уведомления» → «Настроить»
        if (!notificationOn('collector')) return
        if (keep) addNotification({ title: 'Коллекционер', text: message, open: '/kappa-items' })
        void window.tarkovDesktop?.notify?.('Коллекционер', message).catch(() => {})
      }
      const entries = collectorEntries(data.quests, data.items)
      if (!entries.length) { notify('Список предметов не загружен. Обновите каталог в приложении.'); return }
      scanning = true
      notify('Распознавание предметов началось.', false)
      // A hotkey press is one scan of its own: every label on screen is read.
      void scanForCollectorItems(state.raidMode, entries, { restart: true, drain: true }).then((result) => {
        notify(result.ok
          ? result.gameWindow ? `Найдено предметов: ${result.found}. Добавлено новых: ${result.added.length}.` : 'Окно игры не найдено. Откройте схрон и повторите сканирование.'
          : 'Сканирование работает только в приложении для Windows.')
      }).catch((error: unknown) => notify(error instanceof Error ? error.message : 'Не удалось распознать предметы.'))
        .finally(() => { scanning = false })
    })
  }, [])

  return null
}
