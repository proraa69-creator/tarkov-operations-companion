import { useEffect, useMemo, useState } from 'react'
import { Info, Search } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { gearStatsIndex } from '../data/gearStats'
import { tarkovJson } from '../data/tarkovApi'
import { mirrorMode } from '../data/tarkovDataset'
import { useAppState } from '../state/AppState'
import type { GearStats, RaidMode } from '../domain/types'
import { formatPrice } from '../shared/format'
import {
  ARMOR_STEPS, effectiveDurability, gearTierRows, HEADSET_STEPS, HELMET_STEPS, helmetsBlocking, mobilityPenalty,
  SLOT_PRICE_STEPS, slotTierRows, TIERS, type LootGroup, type TierRow,
} from './tierLists'

type View = 'loot' | 'injectors' | 'armor' | 'rig' | 'helmet' | 'headphones'

const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'loot', label: 'Предметы' },
  { id: 'injectors', label: 'Инъекторы' },
  { id: 'armor', label: 'Бронежилеты' },
  { id: 'rig', label: 'Разгрузки с бронёй' },
  { id: 'helmet', label: 'Шлемы' },
  { id: 'headphones', label: 'Наушники' },
]

const LOOT_GROUPS: Array<{ id: LootGroup; label: string }> = [
  { id: 'all', label: 'Всё' },
  { id: 'barter', label: 'Бартер и ценности' },
  { id: 'meds', label: 'Медицина и еда' },
  { id: 'keys', label: 'Ключи' },
]

const MATERIALS: Record<string, [string, string]> = {
  Aramid: ['арамид', 'aramid'], UHMWPE: ['СВМПЭ', 'UHMWPE'], Ceramic: ['керамика', 'ceramic'], Combined: ['комбинированный', 'combined'],
  Titan: ['титан', 'titanium'], ArmoredSteel: ['бронесталь', 'armored steel'], Aluminium: ['алюминий', 'aluminium'], Glass: ['стекло', 'glass'],
}
const DEAFENING: Record<string, [string, string]> = { None: ['нет', 'none'], Low: ['слабое', 'low'], Medium: ['среднее', 'medium'], High: ['сильное', 'high'] }

/** How many tiles a tier shows before «ещё N» (the loot list has hundreds of items). */
const TIER_LIMIT = 60

const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)

/** Gear stats when the catalog came without them (a server that does not send `Item.gear` yet). */
function useGearFallback(mode: RaidMode, needed: boolean) {
  const [stats, setStats] = useState<{ mode: RaidMode; index: Map<string, GearStats> } | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!needed || stats?.mode === mode) return
    let alive = true
    setFailed(false)
    void tarkovJson(`${mirrorMode(mode)}/items`)
      .then((root) => { if (alive) setStats({ mode, index: gearStatsIndex((root as { data?: unknown })?.data ?? root) }) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [mode, needed, stats?.mode])
  return { index: stats?.mode === mode ? stats.index : null, failed }
}

/**
 * «Тир-листы» next to «Звук» in «Настройка экрана» (the owner's test build): S…D columns for loot and injectors by
 * price per slot, armor and helmets by protection and mobility, headsets by hearing distance (src/screen/tierLists.ts).
 */
export function TierListPanel() {
  const { data } = useTarkovData()
  const { raidMode } = useAppState()
  const en = useLocale().locale === 'en'
  const say = (ru: string, english: string) => en ? english : ru
  const [view, setView] = useState<View>('loot')
  const [group, setGroup] = useState<LootGroup>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const gearView = view !== 'loot' && view !== 'injectors'
  const catalogHasGear = useMemo(() => data.items.some((item) => item.gear), [data.items])
  const fallback = useGearFallback(raidMode, gearView && !catalogHasGear)
  const stats = useMemo(() => fallback.index ?? new Map<string, GearStats>(), [fallback.index])

  const rows = useMemo(() => {
    if (view === 'loot') return slotTierRows(data.items, raidMode, group)
    if (view === 'injectors') return slotTierRows(data.items, raidMode, 'injectors')
    return gearTierRows(data.items, raidMode, view, stats)
  }, [data.items, group, raidMode, stats, view])
  const helmets = useMemo(() => view === 'headphones' ? gearTierRows(data.items, raidMode, 'helmet', stats) : [], [data.items, raidMode, stats, view])
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter(({ item }) => `${uiText(item.name)} ${item.name} ${item.shortName}`.toLowerCase().includes(needle)) : rows
  const loading = gearView && !catalogHasGear && !fallback.index && !fallback.failed

  const material = (gear: GearStats) => gear.material ? MATERIALS[gear.material]?.[en ? 1 : 0] ?? gear.material : '—'
  const metric = (row: TierRow) => {
    const gear = row.gear
    if (!gear) return say(`${number(row.score)} ₽/слот`, `${number(row.score)} ₽/slot`)
    if (gear.kind === 'headphones') {
      const range = Math.round(((gear.distanceModifier ?? 1) - 1) * 1000) / 10
      return say(`+${range}% · иск. ${Math.round((gear.distortion ?? 0) * 100)}%`, `+${range}% · dist. ${Math.round((gear.distortion ?? 0) * 100)}%`)
    }
    return say(`Кл.${gear.armorClass} · ${gear.durability} · −${mobilityPenalty(gear)}%`, `Cl.${gear.armorClass} · ${gear.durability} · −${mobilityPenalty(gear)}%`)
  }
  const details = (row: TierRow) => {
    const { item, gear } = row
    const lines = [uiText(item.name)]
    if (!gear) {
      lines.push(say(`${item.width ?? 1}×${item.height ?? 1}, продажа ${formatPrice(row.price ?? 0)} → ${number(row.score)} ₽ за слот`, `${item.width ?? 1}×${item.height ?? 1}, sells for ${formatPrice(row.price ?? 0)} → ${number(row.score)} ₽ per slot`))
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

  const steps = view === 'loot' || view === 'injectors' ? SLOT_PRICE_STEPS : view === 'headphones' ? HEADSET_STEPS : view === 'helmet' ? HELMET_STEPS : ARMOR_STEPS
  const bound = (index: number) => {
    const value = steps[index]
    if (value === undefined) return say(`ниже ${view === 'loot' || view === 'injectors' ? number(steps[3]!) + ' ₽' : steps[3]}`, `below ${view === 'loot' || view === 'injectors' ? number(steps[3]!) + ' ₽' : steps[3]}`)
    return view === 'loot' || view === 'injectors' ? `≥ ${number(value)} ₽` : `≥ ${value}`
  }

  return (
    <section className="panel tier-lists">
      <div className="panel-header">
        <h2>{uiText('Тир-листы')}</h2>
        <span className="tag">{say('Цены', 'Prices')}: {raidMode === 'seasonal' ? say('Сезон', 'Season') : raidMode.toUpperCase()}</span>
      </div>
      <div className="tier-toolbar">
        <div className="segmented-filter" role="tablist">
          {VIEWS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} className={view === entry.id ? 'active' : ''} onClick={() => setView(entry.id)}>{uiText(entry.label)}</button>)}
        </div>
        {view === 'loot' && <div className="segmented-filter tier-groups" role="group">
          {LOOT_GROUPS.map((entry) => <button key={entry.id} type="button" className={group === entry.id ? 'active' : ''} onClick={() => setGroup(entry.id)}>{uiText(entry.label)}</button>)}
        </div>}
        <label className="tier-search"><Search aria-hidden="true" /><input className="input" value={query} placeholder={uiText('Найти предмет…')} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      <p className="tier-how"><Info aria-hidden="true" /><span>{uiText(HOW[view])}</span></p>
      {loading && <p className="tier-note">{uiText('Загружаем свойства брони и наушников…')}</p>}
      {fallback.failed && gearView && !catalogHasGear && <p className="tier-note is-error">{uiText('Не удалось загрузить свойства брони и наушников.')}</p>}
      <div className="tier-board">
        {TIERS.map((tier, index) => {
          const inTier = shown.filter((row) => row.tier === tier)
          const key = `${view}-${tier}`
          const open = expanded.includes(key)
          const tiles = open ? inTier : inTier.slice(0, TIER_LIMIT)
          return (
            <div key={tier} className={`tier-row tier-${tier.toLowerCase()}`}>
              <div className="tier-label"><strong>{tier}</strong><small>{bound(index)}</small></div>
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
      <p className="tier-sources">{uiText('Данные: tarkov.dev (цены выбранного режима и свойства предметов). Наведите на предмет — подробности.')}</p>
    </section>
  )
}

/** «Как считается тир», per list. */
const HOW: Record<View, string> = {
  loot: 'Цена за слот: лучшая цена продажи (барахолка за вычетом комиссии или торговец, который платит больше всех) делится на ширину × высоту предмета. S — от 100 000 ₽ за слот, A — от 40 000, B — от 20 000, C — от 10 000, D — меньше.',
  injectors: 'Инъекторы занимают одну клетку, поэтому цена за слот — это их цена продажи (барахолка за вычетом комиссии или торговец). Пороги те же, что у предметов: S — от 100 000 ₽, A — от 40 000, B — от 20 000, C — от 10 000.',
  armor: 'Очки из 100, как броню оценивает сообщество: класс защиты с пластинами по умолчанию (до 45), прочность с учётом износа материала — арамид и СВМПЭ держатся дольше керамики и стали (до 15), зоны попадания (до 10), штрафы к скорости, эргономике и повороту (до 25), вес (до 5). S — от 80, A — от 70, B — от 60, C — от 50. Цена не влияет: она своя в каждом режиме.',
  rig: 'Разгрузки с бронёй считаются так же, как бронежилеты: класс (до 45), прочность с учётом материала (до 15), зоны (до 10), подвижность (до 25), вес (до 5). S — от 80, A — от 70, B — от 60, C — от 50.',
  helmet: 'Шлемы: класс (до 45), прочность с учётом материала (до 15), зоны — затылок, уши, лицо (до 10), подвижность (до 25), вес (до 5); минус за глушение звука (до 12) и минус 5, если под шлем не надеть наушники. S — от 58, A — от 54, B — от 48, C — от 42.',
  headphones: 'Наушники: главное — дальность слышимости (distanceModifier: 1,135 = +13,5 % = 13,5 очка), затем чистота — каждый процент искажений ниже 18 % добавляет пол-очка. Шумоподавление (ambientVolume) у всех одинаковое, −50 дБ. S — от 16, A — от 12, B — от 8, C — от 4. Наведите на наушники — видно, со сколькими шлемами они не надеваются.',
}
