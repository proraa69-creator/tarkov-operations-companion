import { useEffect, useMemo, useState } from 'react'
import {
  Archive, Backpack, Bomb, Crosshair, Gem, HardHat, Headphones, HeartPulse, Info, KeyRound, Package, RectangleVertical,
  RefreshCw, Search, Shield, ShieldHalf, Syringe, UtensilsCrossed, Wrench, type LucideIcon,
} from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData, useTarkovDataStatus } from '../data/DataProvider'
import { gearStatsIndex, stackSizeIndex } from '../data/gearStats'
import { tarkovJson } from '../data/tarkovApi'
import './tierLists.css'
import { mirrorMode } from '../data/tarkovDataset'
import { useAppState } from '../state/AppState'
import type { GearStats, RaidMode } from '../domain/types'
import { formatPrice, timeAgo } from '../shared/format'
import {
  ARMOR_STEPS, effectiveDurability, gearTierRows, HEADSET_STEPS, HELMET_STEPS, helmetsBlocking, mobilityPenalty,
  slotTierRows, TIERS, type GearGroup, type PriceCategory, type TierRow,
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

/** The categories that also have a list by their stats (armor, armored rigs, helmets, headsets). */
const GEAR: ReadonlySet<PriceCategory> = new Set(['armor', 'rig', 'helmet', 'headphones'])
type Basis = 'stats' | 'price'

const MATERIALS: Record<string, [string, string]> = {
  Aramid: ['арамид', 'aramid'], UHMWPE: ['СВМПЭ', 'UHMWPE'], Ceramic: ['керамика', 'ceramic'], Combined: ['комбинированный', 'combined'],
  Titan: ['титан', 'titanium'], ArmoredSteel: ['бронесталь', 'armored steel'], Aluminium: ['алюминий', 'aluminium'], Glass: ['стекло', 'glass'],
}
const DEAFENING: Record<string, [string, string]> = { None: ['нет', 'none'], Low: ['слабое', 'low'], Medium: ['среднее', 'medium'], High: ['сильное', 'high'] }

/** How many tiles a tier shows before «ещё N» (mods and barter have hundreds of items). */
const TIER_LIMIT = 60

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
/** src/shared/format.ts timeAgo in English. */
function agoEnglish(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`
}

/**
 * Gear stats and ammo stack sizes when the catalog came without them (a server that does not send `Item.gear` /
 * `Item.stackSize` yet): the mode's items file through the data gateway, shared with the other pages that read it.
 */
function useCatalogExtras(mode: RaidMode, needed: boolean) {
  const [extras, setExtras] = useState<{ mode: RaidMode; gear: Map<string, GearStats>; stacks: Map<string, number> } | null>(null)
  // The mode whose items file did not load (another mode's failure says nothing about this one).
  const [failedMode, setFailedMode] = useState<RaidMode | null>(null)
  useEffect(() => {
    if (!needed || extras?.mode === mode) return
    let alive = true
    void tarkovJson(`${mirrorMode(mode)}/items`)
      .then((root) => {
        const data = (root as { data?: unknown })?.data ?? root
        if (alive) setExtras({ mode, gear: gearStatsIndex(data), stacks: stackSizeIndex(data) })
      })
      .catch(() => { if (alive) setFailedMode(mode) })
    return () => { alive = false }
  }, [mode, needed, extras?.mode])
  return { extras: extras?.mode === mode ? extras : null, failed: failedMode === mode }
}

/**
 * «Тир листы» in «Экономика» (owner, 02.11.2026; src/pages/TierListsPage.tsx): the category blocks on top, then S…D rows per category by the price per slot
 * of the catalog the app keeps fresh (every 10 minutes, the chosen mode), and armor / helmets / headsets also by their
 * stats (src/screen/tierLists.ts).
 */
export function TierListPanel() {
  const { data, refresh } = useTarkovData()
  const { updatedAt, isFetching } = useTarkovDataStatus()
  const { raidMode } = useAppState()
  const en = useLocale().locale === 'en'
  const say = (ru: string, english: string) => en ? english : ru
  const [category, setCategory] = useState<PriceCategory>('barter')
  const [basis, setBasis] = useState<Basis>('stats')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const byStats = GEAR.has(category) && basis === 'stats'
  const catalogHasExtras = useMemo(() => data.items.some((item) => item.gear), [data.items])
  const { extras, failed } = useCatalogExtras(raidMode, (byStats || category === 'ammo') && !catalogHasExtras)
  const gearIndex = useMemo(() => extras?.gear ?? new Map<string, GearStats>(), [extras])
  const stacks = useMemo(() => extras?.stacks ?? new Map<string, number>(), [extras])

  const rows = useMemo(() => byStats
    ? gearTierRows(data.items, raidMode, category as GearGroup, gearIndex)
    : slotTierRows(data.items, raidMode, category, stacks), [byStats, category, data.items, gearIndex, raidMode, stacks])
  const helmets = useMemo(() => byStats && category === 'headphones' ? gearTierRows(data.items, raidMode, 'helmet', gearIndex) : [], [byStats, category, data.items, gearIndex, raidMode])
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter(({ item }) => `${uiText(item.name)} ${item.name} ${item.shortName}`.toLowerCase().includes(needle)) : rows
  const loading = (byStats || category === 'ammo') && !catalogHasExtras && !extras && !failed
  const view = byStats ? category as GearGroup : 'price'

  const material = (gear: GearStats) => gear.material ? MATERIALS[gear.material]?.[en ? 1 : 0] ?? gear.material : '—'
  const metric = (row: TierRow) => {
    const gear = byStats ? row.gear : undefined
    if (!gear) return say(`${number(row.score)} ₽/слот`, `${number(row.score)} ₽/slot`)
    if (gear.kind === 'headphones') {
      const range = Math.round(((gear.distanceModifier ?? 1) - 1) * 1000) / 10
      return say(`+${range}% · иск. ${Math.round((gear.distortion ?? 0) * 100)}%`, `+${range}% · dist. ${Math.round((gear.distortion ?? 0) * 100)}%`)
    }
    return say(`Кл.${gear.armorClass} · ${gear.durability} · −${mobilityPenalty(gear)}%`, `Cl.${gear.armorClass} · ${gear.durability} · −${mobilityPenalty(gear)}%`)
  }
  const details = (row: TierRow) => {
    const { item } = row
    const gear = byStats ? row.gear : undefined
    const lines = [uiText(item.name)]
    if (!gear) {
      const stack = category === 'ammo' ? item.stackSize ?? stacks.get(item.id) ?? 1 : 1
      lines.push(stack > 1
        ? say(`Продажа ${formatPrice(row.price ?? 0)} за патрон × ${stack} в клетке → ${number(row.score)} ₽ за слот`, `Sells for ${formatPrice(row.price ?? 0)} a round × ${stack} per cell → ${number(row.score)} ₽ per slot`)
        : say(`${item.width ?? 1}×${item.height ?? 1}, продажа ${formatPrice(row.price ?? 0)} → ${number(row.score)} ₽ за слот`, `${item.width ?? 1}×${item.height ?? 1}, sells for ${formatPrice(row.price ?? 0)} → ${number(row.score)} ₽ per slot`))
      return lines.join('\n')
    }
    lines.push(say(`Очки: ${row.score}`, `Points: ${row.score}`))
    if (gear.kind === 'headphones') {
      lines.push(say(`Дальность слышимости: ×${gear.distanceModifier}`, `Hearing distance: ×${gear.distanceModifier}`))
      lines.push(say(`Искажения: ${Math.round((gear.distortion ?? 0) * 100)}%`, `Distortion: ${Math.round((gear.distortion ?? 0) * 100)}%`))
      lines.push(say(`Компрессор: усиление ${gear.compressorGain} дБ, порог ${gear.compressorThreshold} дБ`, `Compressor: gain ${gear.compressorGain} dB, threshold ${gear.compressorThreshold} dB`))
      lines.push(say(`Не надеть с шлемами: ${helmetsBlocking(gear, helmets)} из ${helmets.length}`, `Does not fit with helmets: ${helmetsBlocking(gear, helmets)} of ${helmets.length}`))
    } else {
      lines.push(say(`Класс ${gear.armorClass}, прочность ${gear.durability} (${material(gear)}, с учётом износа ≈ ${Math.round(effectiveDurability(gear))})`, `Class ${gear.armorClass}, durability ${gear.durability} (${material(gear)}, wear-adjusted ≈ ${Math.round(effectiveDurability(gear))})`))
      lines.push(say(`Зон попадания: ${gear.zones ?? 0}`, `Hit zones: ${gear.zones ?? 0}`))
      lines.push(say(
        `Скорость ${Math.round((gear.speedPenalty ?? 0) * 100)}%, эргономика ${Math.round((gear.ergoPenalty ?? 0) * 100)}%, поворот ${Math.round((gear.turnPenalty ?? 0) * 100)}%`,
        `Speed ${Math.round((gear.speedPenalty ?? 0) * 100)}%, ergonomics ${Math.round((gear.ergoPenalty ?? 0) * 100)}%, turning ${Math.round((gear.turnPenalty ?? 0) * 100)}%`))
      if (item.weight) lines.push(say(`Вес ${item.weight} кг`, `Weight ${item.weight} kg`))
      if (gear.kind === 'helmet') {
        lines.push(say(`Глушит звук: ${DEAFENING[gear.deafening ?? 'None']?.[0]}`, `Muffles sound: ${DEAFENING[gear.deafening ?? 'None']?.[1]}`))
        if (gear.blocksHeadset) lines.push(say('Наушники не надеть', 'No headset fits'))
      }
    }
    lines.push(row.price ? say(`Цена: ${formatPrice(row.price)}`, `Price: ${formatPrice(row.price)}`) : say('Не продаётся в этом режиме', 'Not sold in this mode'))
    return lines.join('\n')
  }

  /** The label under a tier letter: the steps of a stats list, the cheapest price in that tier of a price list. */
  const bound = (index: number, inTier: TierRow[]) => {
    if (!byStats) return inTier.length ? `≥ ${number(Math.min(...inTier.map((row) => row.score)))} ₽` : ''
    const steps = category === 'headphones' ? HEADSET_STEPS : category === 'helmet' ? HELMET_STEPS : ARMOR_STEPS
    const value = steps[index]
    return value === undefined ? say(`ниже ${steps[3]}`, `below ${steps[3]}`) : `≥ ${value}`
  }

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
        <span className="tier-fresh">
          <span className="tag">{say('Цены', 'Prices')}: {raidMode === 'seasonal' ? say('Сезон', 'Season') : raidMode.toUpperCase()}</span>
          <span className="tier-updated">{updatedAt ? say(`обновлены ${timeAgo(updatedAt)}`, `updated ${agoEnglish(updatedAt)}`) : ''}</span>
          <button type="button" className="icon-button" title={uiText('Обновить цены')} aria-label={uiText('Обновить цены')} disabled={isFetching} onClick={refresh}><RefreshCw size={15} className={isFetching ? 'spin' : undefined} /></button>
        </span>
      </div>
      <div className="tier-toolbar">
        {GEAR.has(category) && <div className="segmented-filter tier-basis" role="group">
          <button type="button" className={basis === 'stats' ? 'active' : ''} onClick={() => setBasis('stats')}>{uiText('По характеристикам')}</button>
          <button type="button" className={basis === 'price' ? 'active' : ''} onClick={() => setBasis('price')}>{uiText('По цене за слот')}</button>
        </div>}
        <label className="tier-search"><Search aria-hidden="true" /><input className="input" value={query} placeholder={uiText('Найти предмет…')} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      <p className="tier-how"><Info aria-hidden="true" /><span>{uiText(HOW[view])}{!byStats && category === 'ammo' ? ` ${uiText(AMMO_NOTE)}` : ''}</span></p>
      {loading && <p className="tier-note">{uiText('Загружаем свойства предметов…')}</p>}
      {failed && !catalogHasExtras && <p className="tier-note is-error">{uiText('Не удалось загрузить свойства предметов.')}</p>}
      <div className="tier-board">
        {TIERS.map((tier, index) => {
          const inTier = shown.filter((row) => row.tier === tier)
          const key = `${category}-${view}-${tier}`
          const open = expanded.includes(key)
          const tiles = open ? inTier : inTier.slice(0, TIER_LIMIT)
          return (
            <div key={tier} className={`tier-row tier-${tier.toLowerCase()}`}>
              <div className="tier-label"><strong>{tier}</strong><small>{bound(index, inTier)}</small></div>
              <div className="tier-items">
                {tiles.map((row) => (
                  <div key={row.item.id} className="tier-tile" title={details(row)}>
                    {row.item.iconUrl ? <img src={row.item.iconUrl} alt="" loading="lazy" /> : <span className="tier-no-icon" />}
                    <span className="tier-name">{uiText(row.item.shortName)}</span>
                    <span className="tier-metric">{metric(row)}</span>
                  </div>
                ))}
                {!inTier.length && <span className="tier-empty">—</span>}
                {inTier.length > tiles.length && <button type="button" className="button small ghost" onClick={() => setExpanded((list) => [...list, key])}>{say(`ещё ${inTier.length - tiles.length}`, `${inTier.length - tiles.length} more`)}</button>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="tier-sources">{uiText('Цены выбранного режима, приложение обновляет их каждые 10 минут. Наведите на предмет — подробности.')}</p>
    </section>
    </>
  )
}

const AMMO_NOTE = 'Патроны лежат в клетке стопкой, поэтому цена за слот — цена патрона × размер стопки.'

/** «Как считается тир», per list. */
const HOW: Record<GearGroup | 'price', string> = {
  price: 'Цена за слот: лучшая цена продажи прямо сейчас (минимальное предложение на барахолке за вычетом комиссии или торговец, который платит больше) делится на клетки предмета. Тиры внутри категории: S — лучшие 10 %, A — следующие 20 %, B — 30 %, C — 25 %, D — последние 15 %. Цены выбранного режима, приложение обновляет их каждые 10 минут.',
  armor: 'Очки из 100, как броню оценивает сообщество: класс защиты с пластинами по умолчанию (до 45), прочность с учётом износа материала — арамид и СВМПЭ держатся дольше керамики и стали (до 15), зоны попадания (до 10), штрафы к скорости, эргономике и повороту (до 25), вес (до 5). S — от 80, A — от 70, B — от 60, C — от 50. Цена не влияет: она своя в каждом режиме.',
  rig: 'Разгрузки с бронёй считаются так же, как бронежилеты: класс (до 45), прочность с учётом материала (до 15), зоны (до 10), подвижность (до 25), вес (до 5). S — от 80, A — от 70, B — от 60, C — от 50.',
  helmet: 'Шлемы: класс (до 45), прочность с учётом материала (до 15), зоны — затылок, уши, лицо (до 10), подвижность (до 25), вес (до 5); минус за глушение звука (до 12) и минус 5, если под шлем не надеть наушники. S — от 58, A — от 54, B — от 48, C — от 42.',
  headphones: 'Наушники: главное — дальность слышимости (distanceModifier: 1,135 = +13,5 % = 13,5 очка), затем чистота — каждый процент искажений ниже 18 % добавляет пол-очка. Шумоподавление (ambientVolume) у всех одинаковое, −50 дБ. S — от 16, A — от 12, B — от 8, C — от 4. Наведите на наушники — видно, со сколькими шлемами они не надеваются.',
}
