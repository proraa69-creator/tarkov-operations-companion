import { useMemo } from 'react'
import { Crosshair, Gem, HeartPulse, Map as MapIcon, Package } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { bossMapIds } from '../data/bossFigures'
import { bossDetails } from '../data/bossInfo'
import { bossLoadout, resolveBossItem, type BodyHealth, type BossItemRef } from '../data/bossLoadout'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { formatPrice } from '../shared/format'
import type { Item } from '../domain/types'
import './bossInfoPanel.css'

const PARTS = ['Голова', 'Грудь', 'Живот', 'Левая рука', 'Правая рука', 'Левая нога', 'Правая нога'] as const

/**
 * The Gallery viewer's side panel: who the boss is, the maps he is on, health per body part, the weapons he
 * can carry and the main valuable loot — weapons and loot as picture tiles from the item catalog.
 */
export function BossInfoPanel({ bossKey, basedOn }: { bossKey: string; basedOn?: string }) {
  const { locale } = useLocale()
  const { data } = useTarkovData()
  const info = bossDetails(bossKey)
  const loadout = bossLoadout(bossKey)
  const maps = bossMapIds(bossKey)
  const index = useMemo(() => new Map(data.items.map((entry) => [entry.id, entry])), [data.items])
  if (!info) return null
  const total = loadout?.body ? loadout.body.reduce((sum, value) => sum + value, 0) : info.health

  return <aside className="gallery-viewer-info boss-info" aria-label={uiText('Описание')}>
    <p className="boss-info-about">{info.about[locale]}</p>

    {maps.length > 0 && <section className="boss-info-block">
      <h3><MapIcon size={14} /> {uiText('Где встречается')}</h3>
      <div className="boss-info-maps">{maps.map((id) => <span key={id} className="boss-info-chip">{uiText(MAP_DISPLAY_NAMES[id] ?? id)}</span>)}</div>
    </section>}

    {total ? <section className="boss-info-block">
      <h3><HeartPulse size={14} /> {uiText('Здоровье')} <b className="boss-info-total">{total} HP</b></h3>
      {loadout?.body && <BodyChart body={loadout.body} />}
    </section> : null}

    {loadout?.weapons?.length ? <section className="boss-info-block">
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

    {loadout?.note && <p className="boss-info-note">{loadout.note[locale]}</p>}
    {basedOn && <p className="boss-info-note">{uiText('По мотивам')}: <b>{basedOn}</b></p>}
  </aside>
}

/** Seven body parts as bars scaled to the strongest part, laid out head / torso / arms / legs. */
function BodyChart({ body }: { body: BodyHealth }) {
  const max = Math.max(...body)
  return <div className="boss-info-body">
    {body.map((value, part) => <div key={PARTS[part]} className={`boss-info-part is-part-${part}`}>
      <span className="boss-info-part-name">{uiText(PARTS[part])}</span>
      <span className="boss-info-part-value">{value}</span>
      <span className="boss-info-bar" aria-hidden="true"><i style={{ width: `${Math.round((value / max) * 100)}%` }} /></span>
    </div>)}
  </div>
}

function ItemTiles({ refs, items, index, gun = false, price = false }: { refs: BossItemRef[]; items: Item[]; index: Map<string, Item>; gun?: boolean; price?: boolean }) {
  const { locale } = useLocale()
  return <ul className="boss-info-items">
    {refs.map((ref) => {
      const found = resolveBossItem(ref, items, index, gun)
      const value = price ? found?.fleaPrice ?? Math.max(0, ...(found?.prices ?? []).map((quote) => quote.price)) : 0
      return <li key={ref.name.en} className="boss-info-item" title={found ? uiText(found.name) : ref.name[locale]}>
        <span className="boss-info-item-image">
          {found?.iconUrl ? <img src={found.iconUrl} alt="" loading="lazy" decoding="async" /> : <Package size={20} aria-hidden="true" />}
        </span>
        <span className="boss-info-item-name">{ref.name[locale]}</span>
        {value > 0 && <span className="boss-info-item-price">{formatPrice(value)}</span>}
      </li>
    })}
  </ul>
}
