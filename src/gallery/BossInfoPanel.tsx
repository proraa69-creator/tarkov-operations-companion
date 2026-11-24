import { useMemo, useState, type ReactNode } from 'react'
import { Crosshair, Gem, HeartPulse, Map as MapIcon, Package, Shield, Swords, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { bossTactics, tacticsPath } from '../data/bossTactics'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { bossMapIds } from '../data/bossFigures'
import { bossDetails } from '../data/bossInfo'
import { bossLoadout, resolveBossItem, type BossItemRef } from '../data/bossLoadout'
import { bossGear, bossRetinue, classLabel, lightsWarning, LIGHTS_SHOWN, memberSize, retinueGear, retinueLoot, retinueMaps, retinueSize, type BossGear, type BossGearGroup, type BossGearItem, type BossRetinue, type ClassRange } from '../data/bossGear'
import { dearLoot } from './retinueLoot'
import { BodyHealthFigure } from '../components/BodyHealthFigure'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { useOverviewDefaults } from '../overview/overviewDefaultsStore'
import { formatPrice } from '../shared/format'
import type { Item } from '../domain/types'
import { displayPrice, fleaQuote, traderQuotes } from '../domain/itemPrices'
import { useAppState } from '../state/AppState'
import './bossInfoPanel.css'

/**
 * The Gallery viewer's side panel: who the boss is, the maps he is on, health per body part, the weapons he
 * can carry and the main valuable loot — weapons and loot as picture tiles from the item catalog.
 */
export function BossInfoPanel({ bossKey, basedOn }: { bossKey: string; basedOn?: string }) {
  const { locale } = useLocale()
  const { data } = useTarkovData()
  const info = bossDetails(bossKey)
  const loadout = bossLoadout(bossKey)
  const gear = bossGear(bossKey)
  const retinue = bossRetinue(bossKey)
  const own = useOverviewDefaults()?.bosses
  const maps = bossMapIds(bossKey, own)
  const index = useMemo(() => new Map(data.items.map((entry) => [entry.id, entry])), [data.items])
  if (!info) return null
  const total = loadout?.body ? loadout.body.reduce((sum, value) => sum + value, 0) : info.health

  return <aside className="gallery-viewer-info boss-info" aria-label={uiText('Описание')}>
    {bossTactics(bossKey) && <Link className="button primary boss-tactics-button" to={tacticsPath(bossKey)}><Swords size={15} />{uiText('Тактика боя')}</Link>}
    <p className="boss-info-about">{info.about[locale]}</p>

    {maps.length > 0 && <section className="boss-info-block">
      <h3><MapIcon size={14} /> {uiText('Где встречается')}</h3>
      <div className="boss-info-maps">{maps.map((id) => <span key={id} className="boss-info-chip">{uiText(MAP_DISPLAY_NAMES[id] ?? id)}</span>)}</div>
    </section>}

    {total ? <section className="boss-info-block">
      <h3><HeartPulse size={14} /> {uiText('Здоровье')} <b className="boss-info-total">{total} HP</b></h3>
      {loadout?.body && <BodyHealthFigure body={loadout.body} />}
    </section> : null}

    {gear ? <>
      <section className="boss-info-block">
        <h3><Crosshair size={14} /> {uiText('Вооружение')}</h3>
        <GearGroups gear={gear} render={(group) => <GunTiles group={group} index={index} />} />
      </section>
      <section className="boss-info-block">
        <h3><Shield size={14} /> {uiText('Броня')}</h3>
        <GearGroups gear={gear} render={(group) => <ArmorRow group={group} index={index} />} />
      </section>
    </> : loadout?.weapons?.length ? <section className="boss-info-block">
      <h3><Crosshair size={14} /> {uiText('Вооружение')}</h3>
      <ItemTiles refs={loadout.weapons} items={data.items} index={index} gun />
    </section> : info.weapons ? <section className="boss-info-block">
      <h3><Crosshair size={14} /> {uiText('Вооружение')}</h3>
      <p className="boss-info-text">{info.weapons[locale]}</p>
    </section> : null}

    {loadout?.loot?.length ? <section className="boss-info-block">
      <h3><Gem size={14} /> {uiText('Ценный лут')}</h3>
      <ItemTiles refs={loadout.loot} items={data.items} index={index} price />
    </section> : info.loot ? <section className="boss-info-block">
      <h3><Gem size={14} /> {uiText('Ценный лут')}</h3>
      <p className="boss-info-text">{info.loot[locale]}</p>
    </section> : null}

    {retinue && <RetinueBlock retinue={retinue} items={data.items} index={index} />}

    {loadout?.guardWeapons?.length ? <section className="boss-info-block">
      <h3><Crosshair size={14} /> {uiText('Вооружение охраны')}</h3>
      <ItemTiles refs={loadout.guardWeapons} items={data.items} index={index} gun />
    </section> : null}

    {loadout?.guardLoot?.length ? <section className="boss-info-block">
      <h3><Gem size={14} /> {uiText('Лут охраны')}</h3>
      <ItemTiles refs={loadout.guardLoot} items={data.items} index={index} price />
    </section> : null}

    {loadout?.note && <p className="boss-info-note">{loadout.note[locale]}</p>}
    {basedOn && <p className="boss-info-note">{uiText('По мотивам')}: <b>{basedOn}</b></p>}
  </aside>
}

/**
 * «Свита» (owner, 20.11.2026: «боссам, у которых есть свита, нужно добавить в описание боссов, какая свита, сколько человек, какая
 * броня, оружие и какие у них патроны бывают»; later the same day: «во что они одеты… что с них дорогого… может упасть»): each kind
 * of guard, how many on each map, his guns with their rounds, his armour classes, the helmets, armour and rigs he wears and the
 * dear things he may carry. The Goons: «Вместе с» the other two, their kit as on their own pages.
 */
function RetinueBlock({ retinue, items, index }: { retinue: BossRetinue; items: Item[]; index: Map<string, Item> }) {
  const { locale } = useLocale()
  const { raidMode } = useAppState()
  const total = retinueSize(retinue)
  // each guard's line names the maps when the retinue comes on more than one (Glukhar: Reserve, and Terminal for the security)
  const manyMaps = retinueMaps(retinue).length > 1
  const loot = useMemo(() => retinue.members.map((member) => dearLoot(items, index, raidMode, retinueLoot(member, raidMode).map((entry) => entry.id))),
    [retinue, items, index, raidMode])
  return <section className="boss-info-block boss-retinue">
    {/* «Свита» in English straight: the game's own bot names map «Свита» to «The Wedge (Labs) Guard» */}
    <h3><Users size={14} /> {retinue.squad ? uiText('Вместе с') : locale === 'en' ? 'Retinue' : 'Свита'}
      {!retinue.squad && <b className="boss-info-total">{classLabel(total)} {uiText('чел.')}</b>}</h3>
    {retinue.members.map((member, at) => {
      const kit = retinueGear(member)
      return <div key={member.name.en} className="boss-gear-group">
        <span className="boss-gear-group-title boss-retinue-name">{member.name[locale]}{!retinue.squad && <b>×{classLabel(memberSize(member))}</b>}</span>
        {!retinue.squad && manyMaps && <span className="boss-retinue-maps">
          {member.counts.map((count) => `${count.maps.map((id) => uiText(MAP_DISPLAY_NAMES[id] ?? id)).join(', ')}: ${classLabel([count.min, count.max])}`).join(' · ')}
        </span>}
        {kit && <><GunTiles group={kit} index={index} /><ArmorRow group={kit} index={index} tiles={false} /><WearRows group={kit} index={index} /></>}
        {!member.ref && loot[at]!.length > 0 && <RetinueLootTiles items={loot[at]!} />}
      </div>
    })}
  </section>
}

/**
 * What a guard wears, the most worn first: helmets, armour and rigs, a small picture with each name; the lights on his guns when
 * half of them have one, and what they blind when nearly all do (report 201).
 */
function WearRows({ group, index }: { group: Omit<BossGearGroup, 'maps'>; index: Map<string, Item> }) {
  const { locale } = useLocale()
  const lights = group.lights && group.lights.share >= LIGHTS_SHOWN ? group.lights.devices : []
  const rows: Array<[string, BossGearItem[]]> = [['Шлем', group.helmets ?? []], ['Броня', group.armor], ['Разгрузка', group.rigs ?? []], ['Фонарь', lights]]
  const shown = rows.filter(([, list]) => list.length > 0)
  const warning = lightsWarning(group.lights)
  if (!shown.length) return null
  return <><dl className="boss-retinue-wear">
    {shown.map(([label, list]) => <div key={label} className="boss-retinue-wear-row">
      <dt>{uiText(label)}</dt>
      <dd>{list.map((entry) => {
        const found = index.get(entry.id)
        return <span key={entry.id} className="boss-retinue-wear-item" title={found ? uiText(found.name) : entry.name[locale]}>
          {found?.iconUrl && <img src={found.iconUrl} alt="" loading="lazy" decoding="async" />}{entry.name[locale]}
        </span>
      })}</dd>
    </div>)}
  </dl>
  {warning && <p className="boss-info-note boss-retinue-lights">{uiText(warning)}</p>}</>
}

/** «Может выпасть»: the dear things a guard may carry (retinueLoot.ts), two rows of tiles, «Ещё» for the rest. */
const LOOT_FIRST = 6
function RetinueLootTiles({ items }: { items: Item[] }) {
  const { raidMode } = useAppState()
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, LOOT_FIRST)
  return <div className="boss-retinue-loot">
    <span className="boss-retinue-loot-title"><Gem size={12} /> {uiText('Может выпасть')}</span>
    <ul className="boss-info-items">
      {shown.map((item) => {
        const price = displayPrice(item, raidMode)?.price ?? 0
        return <li key={item.id} className="boss-info-item" title={uiText(item.name)}>
          <span className="boss-info-item-image"><ItemPicture item={item} /></span>
          <span className="boss-info-item-name">{uiText(item.shortName || item.name)}</span>
          {price > 0 && <span className="boss-info-item-price">{formatPrice(price)}</span>}
        </li>
      })}
    </ul>
    {items.length > LOOT_FIRST && <button type="button" className="boss-retinue-loot-more" onClick={() => setAll(!all)}>
      {all ? uiText('Скрыть') : `${uiText('Ещё')} ${items.length - LOOT_FIRST}`}
    </button>}
  </div>
}

/** One kit, or one per map when the boss's kit differs by map (Black Division: lighter plates on Labs and Icebreaker). */
function GearGroups({ gear, render }: { gear: BossGear; render: (group: BossGearGroup) => ReactNode }) {
  if (gear.groups.length === 1) return <>{render(gear.groups[0]!)}</>
  return <>{gear.groups.map((group) => <div key={group.elsewhere ? 'elsewhere' : (group.maps ?? []).join()} className="boss-gear-group">
    <span className="boss-gear-group-title">{group.elsewhere ? uiText('Остальные локации') : (group.maps ?? []).map((id) => uiText(MAP_DISPLAY_NAMES[id] ?? id)).join(' · ')}</span>
    {render(group)}
  </div>)}</>
}

/** The guns with the rounds they are loaded with (report 178: «сборка + патрон»). */
function GunTiles({ group, index }: { group: BossGearGroup; index: Map<string, Item> }) {
  const { locale } = useLocale()
  /** The round pointed at: its name shows inside its gun's tile, never cut by the panel's edge. */
  const [tip, setTip] = useState<{ gun: string; round: string; text: string } | null>(null)
  const away = (gun: string, round: string) => setTip((current) => current?.gun === gun && current.round === round ? null : current)
  return <ul className="boss-info-items is-guns">
    {group.weapons.map((weapon) => {
      const found = index.get(weapon.id)
      // the gun's full name on the gun only: a round under it has its own (owner, 17.11.2026: «название в белом окне с
      // названием оружия не должно появляться при наведении на патрон»)
      const gunName = found ? uiText(found.name) : weapon.name[locale]
      return <li key={weapon.id} className="boss-info-item">
        <span className={`boss-info-item-image${found?.presetImageUrl ? ' is-weapon' : ''}`} title={gunName}><ItemPicture item={found} /></span>
        <span className="boss-info-item-name" title={gunName}>{weapon.name[locale]}</span>
        {weapon.ammo.length > 0 && <span className="boss-gear-ammo">
          {weapon.ammo.map((round) => {
            const item = index.get(round.id)
            const pen = item?.penetration
            const text = `${item ? uiText(item.name) : round.name[locale]}${pen ? ` · ${uiText('пробитие')} ${pen}` : ''}`
            // the round lights up a little and names itself in its own tip (owner, 17.11.2026)
            return <span key={round.id} className={`boss-gear-round${tip?.gun === weapon.id && tip.round === round.id ? ' is-pointed' : ''}`} aria-label={text} tabIndex={0}
              onPointerEnter={() => setTip({ gun: weapon.id, round: round.id, text })} onPointerLeave={() => away(weapon.id, round.id)}
              onFocus={() => setTip({ gun: weapon.id, round: round.id, text })} onBlur={() => away(weapon.id, round.id)}>
              {item?.iconUrl && <img src={item.iconUrl} alt="" loading="lazy" decoding="async" />}
              {round.name[locale]}
            </span>
          })}
        </span>}
        {tip?.gun === weapon.id && <span key={tip.round} className="boss-gear-tip" role="tooltip">{tip.text}</span>}
      </li>
    })}
  </ul>
}

/** Plate classes front, back and sides, the helmet and the face, then the armour itself. */
function ArmorRow({ group, index, tiles = true }: { group: Omit<BossGearGroup, 'maps'>; index: Map<string, Item>; tiles?: boolean }) {
  const { locale } = useLocale()
  // the loadouts leave a helmet's visor out: its face class comes from the item catalog (Killa's Maska-1SCh: 6)
  const visor = group.helmetId ? index.get(group.helmetId)?.gear?.faceClass : undefined
  const face: ClassRange | undefined = group.face ?? (visor ? [visor, visor] : undefined)
  const chips: Array<[string, ClassRange | undefined]> = [
    ['Спереди', group.plates.front], ['Сзади', group.plates.back], ['Бока', group.plates.side],
    ['Шлем', group.helmeted >= 0.5 ? group.helmet : undefined], ['Лицо', face],
  ]
  const shown = chips.filter((chip): chip is [string, ClassRange] => Boolean(chip[1]))
  if (!shown.length && !group.armor.length) return <p className="boss-info-text">{uiText('Брони не носит')}</p>
  return <>
    <div className="boss-gear-classes">
      {shown.map(([label, range]) => <span key={label} className="boss-gear-class" data-class={range[1]} title={`${uiText(label)}: ${classLabel(range)} ${uiText('класс')}`}>
        <span>{uiText(label)}</span><b>{classLabel(range)}</b>
      </span>)}
    </div>
    {group.armored > 0 && group.armored < 0.8 && <p className="boss-info-note">{uiText('Не всегда в броне')}</p>}
    {tiles && group.armor.length > 0 && <ul className="boss-info-items">
      {group.armor.map((armor) => {
        const found = index.get(armor.id)
        return <li key={armor.id} className="boss-info-item" title={found ? uiText(found.name) : armor.name[locale]}>
          <span className="boss-info-item-image"><ItemPicture item={found} /></span>
          <span className="boss-info-item-name">{armor.name[locale]}</span>
        </li>
      })}
    </ul>}
  </>
}

function ItemTiles({ refs, items, index, gun = false, price = false }: { refs: BossItemRef[]; items: Item[]; index: Map<string, Item>; gun?: boolean; price?: boolean }) {
  const { locale } = useLocale()
  const { raidMode } = useAppState()
  return <ul className={`boss-info-items${gun ? ' is-guns' : ''}`}>
    {refs.map((ref) => {
      const found = resolveBossItem(ref, items, index, gun)
      // The flea price of the selected mode (else its best trader), not the highest quote of any mode.
      const value = price ? displayPrice(found, raidMode)?.price ?? 0 : 0
      return <li key={ref.name.en} className="boss-info-item" title={found ? uiText(found.name) : ref.name[locale]}>
        <span className={`boss-info-item-image${ref.image || found?.presetImageUrl ? ' is-weapon' : ''}`}>
          {ref.image ? <img src={ref.image} alt="" loading="lazy" decoding="async" /> : <ItemPicture item={found} />}
        </span>
        <span className="boss-info-item-name">{ref.name[locale]}</span>
        {ref.market ? <MarketPrices item={found} /> : value > 0 && <span className="boss-info-item-price">{formatPrice(value)}</span>}
        {ref.note && <span className="boss-info-item-note">{ref.note[locale]}</span>}
      </li>
    })}
  </ul>
}

/** The flea's price and the best trader's of the mode on screen, as the catalog has them now (report 189). */
function MarketPrices({ item }: { item?: Item }) {
  const { raidMode } = useAppState()
  const flea = fleaQuote(item, raidMode)
  const trader = traderQuotes(item, raidMode)[0]
  return <span className="boss-info-item-market">
    <span>{uiText('Барахолка')}: <b>{flea ? formatPrice(flea.price) : '—'}</b></span>
    <span>{uiText('Торговцу')}: <b>{trader ? formatPrice(trader.price) : '—'}</b>{trader && <small> · {uiText(trader.source)}</small>}</span>
  </span>
}

/** Weapons show the whole gun (tarkov.dev default preset), not the bare receiver; the item icon if that fails. */
function ItemPicture({ item }: { item?: Item }) {
  const [failed, setFailed] = useState<string | null>(null)
  const preset = item?.presetImageUrl && item.presetImageUrl !== failed ? item.presetImageUrl : undefined
  const src = preset ?? item?.iconUrl
  if (!src) return <Package size={20} aria-hidden="true" />
  return <img src={src} alt="" loading="lazy" decoding="async" onError={preset ? () => setFailed(preset) : undefined} />
}
