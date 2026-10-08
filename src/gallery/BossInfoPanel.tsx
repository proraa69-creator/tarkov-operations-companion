import { useMemo, useState } from 'react'
import { Crosshair, Gem, HeartPulse, Map as MapIcon, Package } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useTarkovData } from '../data/DataProvider'
import { bossMapIds } from '../data/bossFigures'
import { bossDetails } from '../data/bossInfo'
import { bossLoadout, resolveBossItem, type BossItemRef } from '../data/bossLoadout'
import { BodyHealthFigure } from '../components/BodyHealthFigure'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
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
      {loadout?.body && <BodyHealthFigure body={loadout.body} />}
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

function ItemTiles({ refs, items, index, gun = false, price = false }: { refs: BossItemRef[]; items: Item[]; index: Map<string, Item>; gun?: boolean; price?: boolean }) {
  const { locale } = useLocale()
  const { raidMode } = useAppState()
  return <ul className={`boss-info-items${gun ? ' is-guns' : ''}`}>
    {refs.map((ref) => {
      const found = resolveBossItem(ref, items, index, gun)
      // The flea price of the selected mode (else its best trader), not the highest quote of any mode.
      const value = price ? displayPrice(found, raidMode)?.price ?? 0 : 0
      return <li key={ref.name.en} className="boss-info-item" title={found ? uiText(found.name) : ref.name[locale]}>
        <span className={`boss-info-item-image${found?.presetImageUrl ? ' is-weapon' : ''}`}>
          <ItemPicture item={found} />
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
