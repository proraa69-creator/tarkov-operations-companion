import { uiText } from '../i18n/renderText'
import type { CSSProperties } from 'react'
import { Building2, Heart, Layers, Users } from 'lucide-react'
import type { BossInfo, Item, MapMarker } from '../domain/types'

interface MapMarkerTooltipProps {
  marker: MapMarker
  typeLabel: string
  color: string
  floor: string
  item?: Item
  boss?: BossInfo
}

export function MapMarkerTooltip({ marker, typeLabel, color, floor, item, boss }: MapMarkerTooltipProps) {
  const indoor = floor !== 'Основной'
  return (
    <div className="mmt" style={{ '--marker-color': color } as CSSProperties}>
      <div className="mmt-head">
        <span className="mmt-type"><span className="mmt-dot" />{uiText(typeLabel)}</span>
        <span className={`mmt-floor${indoor ? ' is-indoor' : ''}`}>
          {uiText(indoor ? <Building2 size={11} /> : <Layers size={11} />)}
          {uiText(floor)}
        </span>
      </div>

      {uiText(boss ? <BossBlock boss={boss} /> : (
        <div className="mmt-title-row">
          {uiText(item?.iconUrl && <img className="mmt-item-icon" src={item.iconUrl} alt={uiText("")} loading="lazy" />)}
          <div className="mmt-title-copy">
            <strong className="mmt-title">{uiText(marker.title)}</strong>
            {uiText(item && <span className="mmt-sub">{uiText(item.name)}</span>)}
          </div>
        </div>
      ))}

      {uiText(marker.description && <p className="mmt-desc">{uiText(marker.description)}</p>)}
      {uiText(!boss && marker.meta && <p className="mmt-meta">{uiText(marker.meta)}</p>)}
      {uiText(marker.approximate && <p className="mmt-meta">{uiText("Точка приблизительная")}</p>)}
    </div>
  )
}

function BossBlock({ boss }: { boss: BossInfo }) {
  const chances = [
    boss.spawnChance != null ? `шанс ${percent(boss.spawnChance)}` : '',
    boss.locationChance != null && boss.locationChance < 1 ? `зона ${percent(boss.locationChance)}` : '',
  ].filter(Boolean)
  return (
    <div className="mmt-boss">
      <div className="mmt-boss-top">
        {uiText(boss.portraitUrl
          ? <img className="mmt-portrait" src={boss.portraitUrl} alt={uiText(boss.name)} loading="lazy" />
          : <span className="mmt-portrait is-empty" aria-hidden="true" />)}
        <div className="mmt-title-copy">
          <strong className="mmt-title">{uiText(boss.name)}</strong>
          {uiText(chances.length > 0 && <span className="mmt-chance">{uiText(chances.join(' · '))}</span>)}
          {uiText(boss.health != null && <span className="mmt-sub"><Heart size={11} /> {uiText(boss.health)} HP</span>)}
        </div>
      </div>
      {uiText(boss.gear?.length ? (
        <div className="mmt-gear">
          {uiText(boss.gear.slice(0, 5).map((entry) => (
            <span className="mmt-gear-item" key={`${entry.slot ?? ''}${entry.name}`} title={uiText(entry.name)}>
              {uiText(entry.iconUrl && <img src={entry.iconUrl} alt={uiText("")} loading="lazy" />)}
              {uiText(entry.name)}
            </span>
          )))}
        </div>
      ) : null)}
      {uiText(boss.escorts?.length ? <p className="mmt-meta"><Users size={11} />{uiText(" Состав: ")}{uiText(boss.escorts.join(', '))}</p> : null)}
    </div>
  )
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}
