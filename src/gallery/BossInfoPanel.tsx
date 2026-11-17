import { useMemo, useState, type ReactNode } from 'react'
import { Crosshair, Gem, HeartPulse, Map as MapIcon, Package, Shield, Swords } from 'lucide-react'
import { Link } from 'react-router-dom'
import { bossTactics, tacticsPath } from '../data/bossTactics'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { bossMapIds } from '../data/bossFigures'
import { bossDetails } from '../data/bossInfo'
import { bossLoadout, resolveBossItem, type BossItemRef } from '../data/bossLoadout'
import { bossGear, classLabel, type BossGear, type BossGearGroup, type ClassRange } from '../data/bossGear'
import { BodyHealthFigure } from '../components/BodyHealthFigure'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { useOverviewDefaults } from '../overview/overviewDefaultsStore'
import { formatPrice } from '../shared/format'
import type { Item } from '../domain/types'
import { displayPrice } from '../domain/itemPrices'
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
        {gear.guards && <div className="boss-gear-guards">
          <span className="boss-gear-group-title">{uiText('Охрана')}</span>
          <ArmorRow group={gear.guards} index={index} tiles={false} />
        </div>}
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
  return <ul className="boss-info-items is-guns">
    {group.weapons.map((weapon) => {
      const found = index.get(weapon.id)
      return <li key={weapon.id} className="boss-info-item" title={found ? uiText(found.name) : weapon.name[locale]}>
        <span className={`boss-info-item-image${found?.presetImageUrl ? ' is-weapon' : ''}`}><ItemPicture item={found} /></span>
        <span className="boss-info-item-name">{weapon.name[locale]}</span>
        {weapon.ammo.length > 0 && <span className="boss-gear-ammo">
          {weapon.ammo.map((round) => {
            const item = index.get(round.id)
            const pen = item?.penetration
            return <span key={round.id} className="boss-gear-round" title={`${item ? uiText(item.name) : round.name[locale]}${pen ? ` · ${uiText('пробитие')} ${pen}` : ''}`}>
              {item?.iconUrl && <img src={item.iconUrl} alt="" loading="lazy" decoding="async" />}
              {round.name[locale]}
            </span>
          })}
        </span>}
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
        {value > 0 && <span className="boss-info-item-price">{formatPrice(value)}</span>}
      </li>
    })}
  </ul>
}

/** Weapons show the whole gun (tarkov.dev default preset), not the bare receiver; the item icon if that fails. */
function ItemPicture({ item }: { item?: Item }) {
  const [failed, setFailed] = useState<string | null>(null)
  const preset = item?.presetImageUrl && item.presetImageUrl !== failed ? item.presetImageUrl : undefined
  const src = preset ?? item?.iconUrl
  if (!src) return <Package size={20} aria-hidden="true" />
  return <img src={src} alt="" loading="lazy" decoding="async" onError={preset ? () => setFailed(preset) : undefined} />
}
