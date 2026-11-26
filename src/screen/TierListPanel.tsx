import { matchesSearchTerms, searchTerms } from '../shared/textSearch'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Archive, Backpack, Bomb, ChevronsDown, ChevronsUp, Crosshair, Gem, HardHat, Headphones, HeartPulse, KeyRound, Package, RectangleVertical,
  RefreshCw, Search, Shield, ShieldHalf, Syringe, UtensilsCrossed, Wrench, type LucideIcon,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData, useTarkovDataStatus } from '../data/DataProvider'
import { gearStatsIndex } from '../data/gearStats'
import { tarkovJson } from '../data/tarkovApi'
import { useLivePrices, withLivePrices } from '../data/livePrices'
import { ammoFromCatalog, caliberLabel, damageText, useAmmoStats } from '../arsenal/ammoSource'
import { effectiveArmorClass } from '../arsenal/ballistics'
import { useHoverCard } from '../components/useHoverCard'
import { usePopupMenu } from '../components/usePopupMenu'
import { useGunCatalog } from '../arsenal/gunCatalog'
import { buildableWeapon } from '../arsenal/tieredBuilds'
import { canToggleVisor, visorPhoto } from './helmetVisors'
import './tierLists.css'
import { mirrorMode } from '../data/tarkovDataset'
import { useAppState } from '../state/AppState'
import type { GearStats, Item, RaidMode } from '../domain/types'
import { useEconomySnapshot } from '../data/useEconomy'
import { questAvailabilityOf } from '../quests/questReadModel'
import { ItemDrawer } from '../components/ItemDrawer'
import { itemBarterUses, itemQuestUses } from './itemUses'
import { ItemNeedsList } from './ItemNeedsList'
import { formatPrice, timeAgo } from '../shared/format'
import {
  ammoTierRows, BACKPACK_STEPS, BY_WHOLE_PRICE, LEVEL_GROUPS, gearTierRows, HEADSET_STEPS, helmetsBlocking, helmetWorn, isFigurine,
  foodStatsIndex, foodTierRows, mobilityPenalty, ricochetLevel, slotTierRows, tilePictures, TIERS, type FoodStats, type GearGroup,
  type PriceCategory, type TierRow, type VisorPosition,
} from './tierLists'

/** The category blocks at the top of «Тир листы» (owner, 02.11.2026: «при открытии там будут сверху блоки с разными категориями»). */
const CATEGORIES: Array<{ id: PriceCategory; label: string; icon: LucideIcon }> = [
  { id: 'barter', label: 'Предметы', icon: Package },
  { id: 'valuables', label: 'Ценности', icon: Gem },
  { id: 'keys', label: 'Ключи', icon: KeyRound },
  { id: 'meds', label: 'Медицина', icon: HeartPulse },
  { id: 'injectors', label: 'Инъекторы', icon: Syringe },
  { id: 'food', label: 'Еда и напитки', icon: UtensilsCrossed },
  { id: 'weapons', label: 'Оружие', icon: Crosshair },
  { id: 'mods', label: 'Модули оружия', icon: Wrench },
  { id: 'ammo', label: 'Патроны', icon: Bomb },
  { id: 'armor', label: 'Бронежилеты', icon: Shield },
  { id: 'rig', label: 'Разгрузки', icon: ShieldHalf },
  { id: 'plates', label: 'Бронеплиты', icon: RectangleVertical },
  { id: 'helmet', label: 'Шлемы', icon: HardHat },
  { id: 'headphones', label: 'Наушники', icon: Headphones },
  { id: 'backpacks', label: 'Рюкзаки', icon: Backpack },
  { id: 'containers', label: 'Контейнеры', icon: Archive },
]

/**
 * The categories listed by their stats, and the gear kind each lists (src/data/gearStats.ts). Armor, rigs, plates and
 * helmets go by protection level, backpacks by their cells, all with no prices (tierLists.ts LEVEL_GROUPS); headsets also
 * have a price list.
 */
const GEAR: Partial<Record<PriceCategory, GearGroup>> = { armor: 'armor', rig: 'rig', plates: 'plate', helmet: 'helmet', headphones: 'headphones', backpacks: 'backpack' }
type Basis = 'stats' | 'price'
/** «Еда и напитки»: the price per slot, or per point of energy or of water. */
type FoodBasis = keyof FoodStats
type Fact = readonly [label: string, value: string]

const MATERIALS: Record<string, [string, string]> = {
  Aramid: ['арамид', 'aramid'], UHMWPE: ['СВМПЭ', 'UHMWPE'], Ceramic: ['керамика', 'ceramic'], Combined: ['комбинированный', 'combined'],
  Titan: ['титан', 'titanium'], ArmoredSteel: ['бронесталь', 'armored steel'], Aluminium: ['алюминий', 'aluminium'], Glass: ['стекло', 'glass'],
}
const DEAFENING: Record<string, [string, string]> = { None: ['нет', 'none'], Low: ['слабо', 'low'], Medium: ['средне', 'medium'], High: ['сильно', 'high'] }
const RICOCHET: Record<ReturnType<typeof ricochetLevel>, [string, string]> = { high: ['высокий', 'high'], medium: ['средний', 'medium'], low: ['низкий', 'low'] }

/** How many tiles a tier shows before «ещё N» (mods and barter have hundreds of items). */
const TIER_LIMIT = 60

// Whole roubles: a price per point of energy reads «413 ₽», never «412,686 ₽».
const number = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)
/** A protection level the way the owner writes it (02.11.2026: «Кл.4 так не пиши, пиши 4LvL»). */
const lvl = (level: number | string) => `${level}LvL`
const percent = (fraction = 0) => `${fraction > 0 ? '+' : fraction < 0 ? '−' : ''}${Math.abs(Math.round(fraction * 100))}%`
/** src/shared/format.ts timeAgo in English. */
function agoEnglish(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
}

/**
 * Gear stats when the catalog came without them (a server that does not send `Item.gear`, or not yet the plates and the
 * helmets' visors): the mode's items file through the data gateway, shared with the other pages that read it.
 */
function useCatalogExtras(mode: RaidMode, needed: boolean) {
  const [extras, setExtras] = useState<{ mode: RaidMode; gear: Map<string, GearStats>; food: Map<string, FoodStats> } | null>(null)
  // The mode whose items file did not load (another mode's failure says nothing about this one).
  const [failedMode, setFailedMode] = useState<RaidMode | null>(null)
  useEffect(() => {
    if (!needed || extras?.mode === mode) return
    let alive = true
    void tarkovJson(`${mirrorMode(mode)}/items`)
      .then((root) => {
        const data = (root as { data?: unknown })?.data ?? root
        if (alive) setExtras({ mode, gear: gearStatsIndex(data), food: foodStatsIndex(data) })
      })
      .catch(() => { if (alive) setFailedMode(mode) })
    return () => { alive = false }
  }, [mode, needed, extras?.mode])
  return { extras: extras?.mode === mode ? extras : null, failed: failedMode === mode }
}

/**
 * One tile and its hover card (owner, 02.11.2026: «всплывающее окно при наведении на предмет … в стиле приложения, все
 * надписи одинаковые, не плавают размеры»): the app's card (components/useHoverCard.tsx) of a fixed width, the tier, the
 * name, the picture and the facts as label — value rows. The picture tries the next address when one does not load
 * (tierLists.ts tilePictures); `onMissing` once none does. Under the facts what the item is needed for (ItemNeedsList); a
 * click or Enter opens the item's full card (report 243: «по клику… раскрыть полную карточку или хотя бы посмотреть полное
 * название»), whose name is never cut in the hover card either.
 */
function TierTile({ row, metric, facts, needs, onOpen, missing, onMissing, visor, presetIcon, photo, toggle, onMenu }: {
  row: TierRow; metric: string; facts: Fact[]; missing: boolean; onMissing: () => void; visor?: string; presetIcon?: string
  /** «Нужен для квестов» / «Нужен для бартеров» under the facts. */
  needs?: ReactNode
  /** The item's full card. */
  onOpen: () => void
  /** A helmet's picture with its visor down or raised (helmetVisors.ts), before its other pictures. */
  photo?: string
  /** The one button of its menu: «Опустить забрало» or «Поднять забрало». */
  toggle?: { label: string; down: boolean; onPick: () => void }
  /** A weapon's right click: «Перейти к сборке оружия» (WeaponMenu). */
  onMenu?: (event: ReactMouseEvent) => void
}) {
  const urls = photo ? [photo, ...tilePictures(row.item, row.gear, presetIcon)] : tilePictures(row.item, row.gear, presetIcon)
  // The picture tried, from the first again when the visor's position gives another one.
  const [tried, setTried] = useState({ photo, at: 0 })
  const at = tried.photo === photo ? tried.at : 0
  const url = !missing ? urls[at] : undefined
  const fail = () => { if (at + 1 < urls.length) setTried({ photo, at: at + 1 }); else onMissing() }
  const weapon = row.item.types?.includes('gun')
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenuAt(null), [])
  // A phone: the long press shows the card, the lifted finger the menu under the tile (over it near the bottom bar).
  const below = (anchor: HTMLElement) => {
    const box = anchor.getBoundingClientRect()
    setMenuAt({ x: box.left, y: window.innerHeight - box.bottom > 130 ? box.bottom + 4 : box.top - 48 })
  }
  const { anchorProps, card } = useHoverCard(
    <div className="tier-card">
      <div className="tier-card-head">
        <span className={`tier-card-badge tier-${row.tier.toLowerCase()}`}>{row.tier}</span>
        <strong>{uiText(row.item.name)}</strong>
      </div>
      <div className={`tier-card-picture${weapon ? ' is-weapon' : ''}${visor ? ' has-visor' : ''}`}>
        {url ? <img src={url} alt="" /> : <span className="tier-no-icon" />}
        {visor && <><span className="tier-card-plus" aria-hidden="true">+</span><img src={visor} alt="" /></>}
      </div>
      <dl className="tier-card-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {needs}
    </div>,
    toggle ? { onHoldEnd: below } : {},
  )
  // A right click (or the keyboard's menu key) opens the menu; a touch never does, the held card would hide under it.
  const holdMenu = 'onContextMenu' in anchorProps ? anchorProps.onContextMenu : undefined
  const onContextMenu = toggle ? (event: ReactMouseEvent<HTMLDivElement>) => {
    holdMenu?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    if (!event.clientX && !event.clientY) below(event.currentTarget)
    else setMenuAt({ x: event.clientX, y: event.clientY })
  } : (onMenu ?? holdMenu)
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter') { event.preventDefault(); onOpen() } }
  // The menu outside the tile: its events do not reach the tile's hover card.
  return (
    <>
      <div className={`tier-tile${weapon ? ' is-weapon' : ''}`} tabIndex={0} {...anchorProps} onContextMenu={onContextMenu} onClick={onOpen} onKeyDown={onKeyDown}>
        {url ? <img key={url} src={url} alt="" loading="lazy" onError={fail} /> : <span className="tier-no-icon" />}
        {visor && <img className="tier-tile-visor" src={visor} alt="" loading="lazy" />}
        <span className="tier-name">{uiText(row.item.shortName)}</span>
        <span className="tier-metric">{metric}</span>
        {card}
      </div>
      {toggle && <VisorMenu at={menuAt} toggle={toggle} onClose={closeMenu} />}
    </>
  )
}

/**
 * A helmet's right-click menu (owner, 20.11.2026: «если забрало поднято… появляется кнопка опустить. Если забрало опущено…
 * кнопка поднять. Одна кнопка, которая меняется в зависимости от положения»).
 */
function VisorMenu({ at, toggle, onClose }: { at: { x: number; y: number } | null; toggle: NonNullable<Parameters<typeof TierTile>[0]['toggle']>; onClose: () => void }) {
  const ref = usePopupMenu(at, onClose)
  if (!at) return null
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 208))
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 52))
  return createPortal(
    <div ref={ref} className="tier-visor-menu" role="menu" style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <button type="button" role="menuitem" onClick={() => { onClose(); toggle.onPick() }}>
        {toggle.down ? <ChevronsUp size={14} aria-hidden="true" /> : <ChevronsDown size={14} aria-hidden="true" />}{toggle.label}
      </button>
    </div>,
    document.body,
  )
}

/**
 * The right click on a weapon of the tier list (owner, 20.11.2026: «нажатие правой кнопкой по оружию, и появляется кнопка перейти к
 * сборке оружия… только у того оружия, которое есть в списке сборка оружия»): «Перейти к сборке оружия». Escape or a click
 * elsewhere closes it.
 */
function WeaponMenu({ menu, onClose }: { menu: { x: number; y: number; weaponId: string; title: string } | null; onClose: () => void }) {
  const ref = usePopupMenu(menu, onClose)
  const navigate = useNavigate()
  if (!menu) return null
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 268))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 90))
  return createPortal(
    <div ref={ref} className="point-menu" role="menu" aria-label={uiText('Меню оружия')} style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="point-menu-title">{uiText(menu.title)}</div>
      <button type="button" role="menuitem" onClick={() => { onClose(); navigate(`/arsenal/builds?weapon=${encodeURIComponent(menu.weaponId)}`) }}><Wrench size={13} aria-hidden="true" />{uiText('Перейти к сборке оружия')}</button>
    </div>,
    document.body,
  )
}

/** «Обновить цены» with the app's hover card for its name. */
function RefreshButton({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  const label = uiText('Обновить цены')
  const { anchorProps, card } = useHoverCard(<span className="tier-card-hint">{label}</span>)
  return <><button type="button" className="icon-button" aria-label={label} disabled={busy} onClick={onClick} {...anchorProps}><RefreshCw size={15} className={busy ? 'spin' : undefined} /></button>{card}</>
}

/**
 * «Тир листы» in «Экономика» (owner, 02.11.2026; src/pages/TierListsPage.tsx): the category blocks on top, then S…D rows.
 * Prices: the flea price per slot (weapons: the whole price) at this minute's prices of the chosen mode
 * (src/data/livePrices.ts). Armor, rigs, plates and helmets by protection level, ammo by penetration, headsets by their
 * stats (src/screen/tierLists.ts). No explanation texts over the board (owner: «эти надписи нужно убрать везде»): a
 * tile's hover card says it all. An item whose picture does not load leaves the list, a figurine aside (owner:
 * «предметы без картинок … убери кроме фигурок»).
 */
export function TierListPanel() {
  const { data, refresh } = useTarkovData()
  const { updatedAt, isFetching } = useTarkovDataStatus()
  const appState = useAppState()
  const { raidMode } = appState
  const { locale } = useLocale()
  const en = locale === 'en'
  const say = (ru: string, english: string) => en ? english : ru
  const [category, setCategory] = useState<PriceCategory>('barter')
  // Which weapons «Сборка оружия» lists (no flare or rocket guns, no grenade launchers): its catalogue, on the «Оружие» tab only
  const guns = useGunCatalog(raidMode, locale, category === 'weapons')
  const buildable = useMemo(() => new Set((guns.data?.weapons ?? []).filter((weapon) => buildableWeapon(weapon)).map((weapon) => weapon.id)), [guns.data])
  const [weaponMenu, setWeaponMenu] = useState<{ x: number; y: number; weaponId: string; title: string } | null>(null)
  const closeWeaponMenu = useCallback(() => setWeaponMenu(null), [])
  const [basis, setBasis] = useState<Basis>('stats')
  // Owner, 05.11.2026: «не нужно писать цену за слот… за какую цену сколько энергии получает человек и воды то же самое».
  const [foodBasis, setFoodBasis] = useState<FoodBasis>('energy')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  // Helmets whose visor the player raised (helmetVisors.ts); the rest have it down, as the list ranks them.
  const [raised, setRaised] = useState<ReadonlySet<string>>(() => new Set())
  const isAmmo = category === 'ammo'
  const group = GEAR[category]
  const byLevel = group ? LEVEL_GROUPS.has(group) : false
  const byStats = Boolean(group) && (byLevel || basis === 'stats')
  // Ammo and the level lists show no price (owner, 02.11.2026: «в тир листе патронов убери цену», «бронежилетов - убери
  // цены», рюкзаки «а цены убери»).
  const noPrices = isAmmo || byLevel
  const live = useLivePrices(raidMode)
  const items = useMemo(() => withLivePrices(data.items, raidMode, live), [data.items, raidMode, live])
  const byId = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  // What each item is needed for (screen/itemUses.ts): this mode's quests by this mode's progress, its traders' barters.
  const progress = appState.activeProfile?.modes[raidMode]
  const availability = useMemo(() => progress && data.quests?.length ? questAvailabilityOf(data.quests, progress) : undefined, [data.quests, progress])
  const questUses = useMemo(() => itemQuestUses(data.quests ?? [], progress, (id) => availability?.get(id)?.status ?? progress?.taskProgress[id]?.status), [data.quests, progress, availability])
  const economy = useEconomySnapshot(raidMode)
  const barterUses = useMemo(() => itemBarterUses(economy.data?.mode === raidMode ? economy.data.barters : []), [economy.data, raidMode])
  const [opened, setOpened] = useState<Item | null>(null)
  const closeCard = useCallback(() => setOpened(null), [])
  const needsOf = (itemId: string, short: boolean) => {
    const quests = questUses.get(itemId) ?? []
    const barters = barterUses.get(itemId) ?? []
    return quests.length || barters.length ? <ItemNeedsList quests={quests} barters={barters} items={byId} en={en} short={short} /> : undefined
  }
  // The catalog's own stats when it has them for this list (helmets: with their visors and ricochet), else the items file's.
  const catalogHasGear = useMemo(() => !group || data.items.some((item) => item.gear?.kind === group && (group !== 'helmet' || item.gear.ricochet !== undefined)), [data.items, group])
  const byFood = category === 'food'
  const { extras, failed } = useCatalogExtras(raidMode, (byStats && !catalogHasGear) || byFood)
  const foodIndex = useMemo(() => extras?.food ?? new Map<string, FoodStats>(), [extras])
  const gearIndex = useMemo(() => extras?.gear ?? new Map<string, GearStats>(), [extras])
  // The «Баллистика» table's rounds (src/pages/ReferencePages.tsx AmmoPage), the catalog's until they come.
  const ammo = useAmmoStats(raidMode, locale, isAmmo)
  const rounds = useMemo(() => isAmmo ? ammo.data?.length ? ammo.data : ammoFromCatalog(items, raidMode) : [], [ammo.data, isAmmo, items, raidMode])

  const pictured = useMemo(() => items.filter((item) => isFigurine(item) || (tilePictures(item).length > 0 && !missing.has(item.id))), [items, missing])
  const rows = useMemo(() => isAmmo
    ? ammoTierRows(rounds).filter((row) => tilePictures(row.item).length > 0 && !missing.has(row.item.id))
    : byFood ? foodTierRows(pictured, raidMode, foodBasis, foodIndex)
    : byStats && group ? gearTierRows(pictured, raidMode, group, gearIndex) : slotTierRows(pictured, raidMode, category),
  [byFood, byStats, category, foodBasis, foodIndex, gearIndex, group, isAmmo, missing, pictured, raidMode, rounds])
  const helmets = useMemo(() => byStats && group === 'headphones' ? gearTierRows(items, raidMode, 'helmet', gearIndex) : [], [byStats, group, items, gearIndex, raidMode])
  const terms = searchTerms(query)
  const shown = terms.length ? rows.filter(({ item }) => matchesSearchTerms(terms, uiText(item.name), item.name, item.shortName)) : rows
  const loading = ((byStats && !catalogHasGear) || byFood) && !extras && !failed
  const pricesAt = live?.updatedAt ?? updatedAt

  const material = (gear: GearStats) => gear.material ? MATERIALS[gear.material]?.[en ? 1 : 0] ?? gear.material : '—'
  const positionOf = (row: TierRow): VisorPosition => raised.has(row.item.id) ? 'up' : 'down'
  const ricochet = (value: number) => RICOCHET[ricochetLevel(value)][en ? 1 : 0]
  const metric = (row: TierRow) => {
    if (row.ammo) return say(`проб. ${row.ammo.penetration} · урон ${damageText(row.ammo)}`, `pen ${row.ammo.penetration} · dmg ${damageText(row.ammo)}`)
    if (row.food) return foodBasis === 'energy' ? say(`+${row.food.energy} энергии · ${number(row.score)} ₽ за 1`, `+${row.food.energy} energy · ${number(row.score)} ₽ per 1`) : say(`+${row.food.hydration} воды · ${number(row.score)} ₽ за 1`, `+${row.food.hydration} water · ${number(row.score)} ₽ per 1`)
    const gear = byStats ? row.gear : undefined
    if (!gear) return BY_WHOLE_PRICE.has(category) ? formatPrice(row.score) : say(`${number(row.score)} ₽/слот`, `${number(row.score)} ₽/slot`)
    if (gear.kind === 'headphones') {
      const range = Math.round(((gear.distanceModifier ?? 1) - 1) * 1000) / 10
      return say(`+${range}% · иск. ${Math.round((gear.distortion ?? 0) * 100)}%`, `+${range}% · dist. ${Math.round((gear.distortion ?? 0) * 100)}%`)
    }
    if (gear.kind === 'backpack') return say(`${gear.capacity ?? 0} ячеек`, `${gear.capacity ?? 0} cells`)
    if (gear.kind === 'helmet') return `${lvl(helmetWorn(gear, row.item.weight, positionOf(row)).level)} · ${gear.durability ?? '—'}`
    return `${lvl(gear.armorClass ?? '—')} · ${gear.durability ?? '—'} · −${mobilityPenalty(gear)}%`
  }
  const facts = (row: TierRow): Fact[] => {
    const { item } = row
    if (row.ammo) {
      const round = row.ammo
      const pierces = effectiveArmorClass(round.penetration)
      return [
        [say('Калибр', 'Caliber'), caliberLabel(round.caliber)],
        [say('Пробитие', 'Penetration'), String(round.penetration)],
        [say('Урон', 'Damage'), damageText(round)],
        ...(round.armorDamage !== undefined ? [[say('Урон броне', 'Armor damage'), `${round.armorDamage}%`] as Fact] : []),
        [say('Пробивает броню', 'Pierces armor'), pierces ? say(`до ${lvl(pierces)}`, `up to ${lvl(pierces)}`) : say('ниже 1LvL', 'below 1LvL')],
      ]
    }
    const gear = byStats ? row.gear : undefined
    if (!gear) {
      const where = row.priceKind === 'trader' ? say('Цена у торговца', 'Trader price') : say('Цена на барахолке', 'Flea price')
      if (row.food) return [
        [where, formatPrice(row.price ?? 0)],
        [say('Энергия', 'Energy'), `+${row.food.energy}`],
        [say('Вода', 'Water'), `+${row.food.hydration}`],
        foodBasis === 'energy' ? [say('Цена за 1 энергии', 'Price per 1 energy'), `${number(row.score)} ₽`] : [say('Цена за 1 воды', 'Price per 1 water'), `${number(row.score)} ₽`],
      ]
      if (BY_WHOLE_PRICE.has(category)) return [[where, formatPrice(row.price ?? 0)]]
      return [
        [where, formatPrice(row.price ?? 0)],
        [say('Размер', 'Size'), `${item.width ?? 1}×${item.height ?? 1}`],
        [say('Цена за слот', 'Price per slot'), `${number(row.score)} ₽`],
      ]
    }
    if (gear.kind === 'headphones') return [
      [say('Слышимость', 'Hearing distance'), `+${Math.round(((gear.distanceModifier ?? 1) - 1) * 1000) / 10}%`],
      [say('Искажения', 'Distortion'), `${Math.round((gear.distortion ?? 0) * 100)}%`],
      [say('Компрессор', 'Compressor'), `${gear.compressorGain ?? 0} / ${gear.compressorThreshold ?? 0} ${say('дБ', 'dB')}`],
      [say('Не надеть со шлемами', 'Helmets it does not fit'), `${helmetsBlocking(gear, helmets)} ${say('из', 'of')} ${helmets.length}`],
      [say('Цена', 'Price'), row.price ? formatPrice(row.price) : say('не продаётся', 'not sold')],
    ]
    // A helmet as worn: its visor's penalties and weight in (helmetWorn), its face only while the visor is down.
    const worn = gear.kind === 'helmet' ? helmetWorn(gear, item.weight, positionOf(row)) : undefined
    const penalties = worn ?? gear
    const mobility: Fact = [say('Скорость · эрг. · поворот', 'Speed · ergo · turn'), `${percent(penalties.speedPenalty)} · ${percent(penalties.ergoPenalty)} · ${percent(penalties.turnPenalty)}`]
    const weightKg = worn ? worn.weight : item.weight
    const weight: Fact[] = weightKg ? [[say('Вес', 'Weight'), `${weightKg} ${say('кг', 'kg')}`]] : []
    if (gear.kind === 'backpack') return [
      [say('Ячеек внутри', 'Cells inside'), String(gear.capacity ?? 0)],
      [say('Размер', 'Size'), `${item.width ?? 1}×${item.height ?? 1}`],
      mobility,
      ...weight,
    ]
    const list: Fact[] = []
    if (gear.kind === 'helmet' && worn) {
      const visor = gear.visorId ? byId.get(gear.visorId) : undefined
      const visorName = visor ? uiText(visor.shortName) : say('есть', 'yes')
      if (gear.visor && positionOf(row) === 'up') {
        // Raised: the helmet alone guards (owner, 20.11.2026: «с поднятым забралом характеристики пишутся без забрала»).
        list.push([say('Уровень', 'Level'), lvl(worn.level)])
        list.push([say('Забрало', 'Visor'), `${visorName} · ${say('поднято', 'raised')}`])
      } else {
        list.push([say('Уровень с забралом', 'Level with the visor'), lvl(worn.level)])
        list.push([say('Шлем', 'Helmet'), lvl(gear.armorClass ?? '—')])
        list.push([say('Забрало', 'Visor'), gear.visorId ? `${visorName} · ${lvl(gear.faceClass ?? '—')}` : gear.faceClass ? say('лицо закрыто самим шлемом', 'the helmet covers the face') : say('нет', 'none')])
      }
    } else {
      list.push([gear.kind === 'plate' ? say('Уровень плиты', 'Plate level') : say('Уровень бронеплит', 'Plate level'), lvl(gear.armorClass ?? '—')])
    }
    list.push([say('Прочность', 'Durability'), `${gear.durability ?? '—'} · ${material(gear)}`])
    const zones = worn ? worn.zones : gear.zones
    if (zones) list.push([say('Зоны попадания', 'Hit zones'), String(zones)])
    if (worn?.ricochet !== undefined) {
      const own = ricochet(worn.ricochet)
      const face = worn.visorRicochet !== undefined ? ricochet(worn.visorRicochet) : undefined
      list.push([say('Рикошет', 'Ricochet'), face && face !== own ? `${say('шлем', 'helmet')} ${own} · ${say('забрало', 'visor')} ${face}` : own])
    }
    list.push(mobility, ...weight)
    if (gear.kind === 'helmet') {
      list.push([say('Глушит звук', 'Muffles sound'), DEAFENING[gear.deafening ?? 'None']?.[en ? 1 : 0] ?? '—'])
      list.push([say('Наушники', 'Headset'), gear.blocksHeadset ? say('не надеть', 'does not fit') : say('надеваются', 'fits')])
    }
    if (!noPrices) list.push([say('Цена', 'Price'), row.price ? formatPrice(row.price) : say('не продаётся', 'not sold')])
    return list
  }

  /** The label under a tier letter: the level of a protection list, the class ammo pierces, the bound of a price list. */
  const bound = (index: number, inTier: TierRow[]) => {
    if (isAmmo) return index < 4 ? say(`до ${lvl(6 - index)}`, `up to ${lvl(6 - index)}`) : say('2LvL и ниже', '2LvL and below')
    if (group === 'helmet') return index === 0 ? lvl('5–6') : lvl(5 - index)
    if (group === 'backpack') return index < 4 ? say(`от ${BACKPACK_STEPS[index]} ячеек`, `${BACKPACK_STEPS[index]}+ cells`) : say(`меньше ${BACKPACK_STEPS[3]}`, `under ${BACKPACK_STEPS[3]}`)
    if (byLevel) return index < 4 ? lvl(6 - index) : say('2LvL и ниже', '2LvL and below')
    if (!byStats) return inTier.length ? `≥ ${number(Math.min(...inTier.map((row) => row.score)))} ₽` : ''
    const value = HEADSET_STEPS[index]
    return value === undefined ? say(`ниже ${HEADSET_STEPS[3]}`, `below ${HEADSET_STEPS[3]}`) : `≥ ${value}`
  }
  // A helmet whose visor the game has no assembled picture of: the visor beside it (owner, 02.11.2026: «с забралом»).
  // A helmet photographed with its visor down and raised (helmetVisors.ts) shows that picture instead.
  const visorOf = (row: TierRow) => {
    const gear = byStats ? row.gear : undefined
    if (gear?.kind !== 'helmet' || !gear.visorId || gear.presetId || canToggleVisor(row.item.id, gear)) return undefined
    return byId.get(gear.visorId)?.iconUrl
  }
  // «Перейти к сборке оружия» on a weapon «Сборка оружия» lists
  const menuOf = (row: TierRow) => buildable.has(row.item.id) ? (event: ReactMouseEvent) => { event.preventDefault(); setWeaponMenu({ x: event.clientX, y: event.clientY, weaponId: row.item.id, title: row.item.name }) } : undefined
  const toggleOf = (row: TierRow) => {
    const gear = byStats ? row.gear : undefined
    if (!canToggleVisor(row.item.id, gear)) return undefined
    const down = positionOf(row) === 'down'
    return {
      down,
      label: down ? say('Поднять забрало', 'Raise the visor') : say('Опустить забрало', 'Lower the visor'),
      onPick: () => setRaised((set) => { const next = new Set(set); if (down) next.add(row.item.id); else next.delete(row.item.id); return next }),
    }
  }
  const tile = (row: TierRow) => <TierTile key={row.item.id} row={row} onMenu={menuOf(row)} metric={metric(row)} facts={facts(row)} missing={missing.has(row.item.id)}
    needs={needsOf(row.item.id, true)} onOpen={() => setOpened(byId.get(row.item.id) ?? row.item)}
    onMissing={() => setMissing((set) => new Set(set).add(row.item.id))} visor={visorOf(row)} presetIcon={row.gear?.presetId ? byId.get(row.gear.presetId)?.iconUrl : undefined}
    photo={byStats ? visorPhoto(row.item.id, row.gear, positionOf(row)) : undefined} toggle={toggleOf(row)} />

  return (
    <>
    <div className="tier-category-grid" role="tablist" aria-label={uiText('Категории')}>
      {CATEGORIES.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" role="tab" aria-selected={category === id} className={`tier-category${category === id ? ' active' : ''}`} onClick={() => setCategory(id)}>
          <Icon aria-hidden="true" /><span>{uiText(label)}</span>
        </button>
      ))}
    </div>
    <section className="panel tier-lists">
      <div className="panel-header">
        <h2>{uiText(CATEGORIES.find((entry) => entry.id === category)?.label ?? 'Тир листы')}</h2>
        {!noPrices && <span className="tier-fresh">
          <span className="tag">{say('Цены', 'Prices')}: {raidMode === 'seasonal' ? say('Сезон', 'Season') : raidMode.toUpperCase()}</span>
          <span className="tier-updated">{pricesAt ? say(`обновлены ${timeAgo(pricesAt)}`, `updated ${agoEnglish(pricesAt)}`) : ''}</span>
          <RefreshButton busy={isFetching} onClick={refresh} />
        </span>}
      </div>
      <div className="tier-toolbar">
        {category === 'food' && <div className="segmented-filter tier-basis" role="group">
          <button type="button" className={foodBasis === 'energy' ? 'active' : ''} onClick={() => setFoodBasis('energy')}>{uiText('Цена за энергию')}</button>
          <button type="button" className={foodBasis === 'hydration' ? 'active' : ''} onClick={() => setFoodBasis('hydration')}>{uiText('Цена за воду')}</button>
        </div>}
        {group && !byLevel && <div className="segmented-filter tier-basis" role="group">
          <button type="button" className={basis === 'stats' ? 'active' : ''} onClick={() => setBasis('stats')}>{uiText('По характеристикам')}</button>
          <button type="button" className={basis === 'price' ? 'active' : ''} onClick={() => setBasis('price')}>{uiText('По цене за слот')}</button>
        </div>}
        <label className="tier-search"><Search aria-hidden="true" /><input className="input" value={query} placeholder={uiText('Найти предмет…')} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      {loading && <p className="tier-note">{uiText('Загружаем свойства предметов…')}</p>}
      {failed && ((byStats && !catalogHasGear) || byFood) && <p className="tier-note is-error">{uiText('Не удалось загрузить свойства предметов.')}</p>}
      <div className="tier-board">
        {TIERS.map((tier, index) => {
          const inTier = shown.filter((row) => row.tier === tier)
          const key = `${category}-${byStats ? 'stats' : 'price'}-${tier}`
          const open = expanded.includes(key)
          const tiles = open ? inTier : inTier.slice(0, TIER_LIMIT)
          return (
            <div key={tier} className={`tier-row tier-${tier.toLowerCase()}`}>
              <div className="tier-label"><strong>{tier}</strong><small>{bound(index, inTier)}</small></div>
              <div className="tier-items">
                {tiles.map(tile)}
                {!inTier.length && <span className="tier-empty">—</span>}
                {inTier.length > tiles.length && <button type="button" className="button small ghost" onClick={() => setExpanded((list) => [...list, key])}>{say(`ещё ${inTier.length - tiles.length}`, `${inTier.length - tiles.length} more`)}</button>}
              </div>
            </div>
          )
        })}
      </div>
    </section>
    <WeaponMenu menu={weaponMenu} onClose={closeWeaponMenu} />
    {opened && <ItemDrawer item={opened} onClose={closeCard} extra={needsOf(opened.id, false)} />}
    </>
  )
}
