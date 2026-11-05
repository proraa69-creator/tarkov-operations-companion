import { useEffect, useMemo, useState } from 'react'
import {
  Archive, Backpack, Bomb, Crosshair, Gem, HardHat, Headphones, HeartPulse, KeyRound, Package, RectangleVertical,
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
import './tierLists.css'
import { mirrorMode } from '../data/tarkovDataset'
import { useAppState } from '../state/AppState'
import type { GearStats, RaidMode } from '../domain/types'
import { formatPrice, timeAgo } from '../shared/format'
import {
  ammoTierRows, BACKPACK_STEPS, BY_WHOLE_PRICE, LEVEL_GROUPS, gearTierRows, HEADSET_STEPS, helmetsBlocking, isFigurine,
  foodStatsIndex, foodTierRows, mobilityPenalty, protectionLevel, slotTierRows, tilePictures, TIERS, type FoodStats, type GearGroup, type PriceCategory, type TierRow,
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

/** How many tiles a tier shows before «ещё N» (mods and barter have hundreds of items). */
const TIER_LIMIT = 60

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
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
 * (tierLists.ts tilePictures); `onMissing` once none does.
 */
function TierTile({ row, metric, facts, missing, onMissing, visor, presetIcon }: { row: TierRow; metric: string; facts: Fact[]; missing: boolean; onMissing: () => void; visor?: string; presetIcon?: string }) {
  const urls = tilePictures(row.item, row.gear, presetIcon)
  const [at, setAt] = useState(0)
  const url = !missing ? urls[at] : undefined
  const fail = () => { if (at + 1 < urls.length) setAt(at + 1); else onMissing() }
  const weapon = row.item.types?.includes('gun')
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
    </div>,
  )
  return (
    <div className={`tier-tile${weapon ? ' is-weapon' : ''}`} tabIndex={0} {...anchorProps}>
      {url ? <img key={url} src={url} alt="" loading="lazy" onError={fail} /> : <span className="tier-no-icon" />}
      {visor && <img className="tier-tile-visor" src={visor} alt="" loading="lazy" />}
      <span className="tier-name">{uiText(row.item.shortName)}</span>
      <span className="tier-metric">{metric}</span>
      {card}
    </div>
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
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const en = locale === 'en'
  const say = (ru: string, english: string) => en ? english : ru
  const [category, setCategory] = useState<PriceCategory>('barter')
  const [basis, setBasis] = useState<Basis>('stats')
  // Owner, 05.11.2026: «не нужно писать цену за слот… за какую цену сколько энергии получает человек и воды то же самое».
  const [foodBasis, setFoodBasis] = useState<FoodBasis>('energy')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
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
  // The catalog's own stats when it has them for this list (helmets: with their visors), else the items file's.
  const catalogHasGear = useMemo(() => !group || data.items.some((item) => item.gear?.kind === group && (group !== 'helmet' || item.gear.faceClass !== undefined)), [data.items, group])
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
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter(({ item }) => `${uiText(item.name)} ${item.name} ${item.shortName}`.toLowerCase().includes(needle)) : rows
  const loading = ((byStats && !catalogHasGear) || byFood) && !extras && !failed
  const pricesAt = live?.updatedAt ?? updatedAt

  const material = (gear: GearStats) => gear.material ? MATERIALS[gear.material]?.[en ? 1 : 0] ?? gear.material : '—'
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
    if (gear.kind === 'helmet') return `${lvl(protectionLevel(gear))} · ${gear.durability ?? '—'}`
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
    const mobility: Fact = [say('Скорость · эрг. · поворот', 'Speed · ergo · turn'), `${percent(gear.speedPenalty)} · ${percent(gear.ergoPenalty)} · ${percent(gear.turnPenalty)}`]
    const weight: Fact[] = item.weight ? [[say('Вес', 'Weight'), `${item.weight} ${say('кг', 'kg')}`]] : []
    if (gear.kind === 'backpack') return [
      [say('Ячеек внутри', 'Cells inside'), String(gear.capacity ?? 0)],
      [say('Размер', 'Size'), `${item.width ?? 1}×${item.height ?? 1}`],
      mobility,
      ...weight,
    ]
    const list: Fact[] = []
    if (gear.kind === 'helmet') {
      const visor = gear.visorId ? byId.get(gear.visorId) : undefined
      list.push([say('Уровень с забралом', 'Level with the visor'), lvl(protectionLevel(gear))])
      list.push([say('Шлем', 'Helmet'), lvl(gear.armorClass ?? '—')])
      list.push([say('Забрало', 'Visor'), gear.visorId ? `${visor ? uiText(visor.shortName) : say('есть', 'yes')} · ${lvl(gear.faceClass ?? '—')}` : gear.faceClass ? say('лицо закрыто самим шлемом', 'the helmet covers the face') : say('нет', 'none')])
    } else {
      list.push([gear.kind === 'plate' ? say('Уровень плиты', 'Plate level') : say('Уровень бронеплит', 'Plate level'), lvl(gear.armorClass ?? '—')])
    }
    list.push([say('Прочность', 'Durability'), `${gear.durability ?? '—'} · ${material(gear)}`])
    if (gear.zones) list.push([say('Зоны попадания', 'Hit zones'), String(gear.zones)])
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
  const visorOf = (row: TierRow) => {
    const gear = byStats ? row.gear : undefined
    if (gear?.kind !== 'helmet' || !gear.visorId || gear.presetId) return undefined
    return byId.get(gear.visorId)?.iconUrl
  }
  const tile = (row: TierRow) => <TierTile key={row.item.id} row={row} metric={metric(row)} facts={facts(row)} missing={missing.has(row.item.id)}
    onMissing={() => setMissing((set) => new Set(set).add(row.item.id))} visor={visorOf(row)} presetIcon={row.gear?.presetId ? byId.get(row.gear.presetId)?.iconUrl : undefined} />

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
    </>
  )
}
