import { uiText } from '../i18n/renderText'
import { useState, type CSSProperties } from 'react'
import { Building2, Heart, Layers, Users } from 'lucide-react'
import type { BossInfo, Item, KeycardColor, MapMarker, PossibleSpot } from '../domain/types'
import { GUARANTEED_SPAWN_TEXT, possibleSpotText } from '../data/mapMarkerAdapter'
import { bossBustFor, isGenericPortrait } from '../assets/bossBusts'

interface MapMarkerTooltipProps {
  marker: MapMarker
  typeLabel: string
  color: string
  floor: string
  item?: Item
  boss?: BossInfo
}

/** Screenshots live in public/extract-shots/<mapId>/<extractId>.jpg — see docs/extract-screenshots.md. */
export function extractScreenshotUrl(marker: Pick<MapMarker, 'mapId' | 'extractId'>) {
  return marker.extractId ? `${import.meta.env.BASE_URL}extract-shots/${marker.mapId}/${marker.extractId}.jpg` : undefined
}

function ExtractShot({ url, alt }: { url: string; alt: string }) {
  const [missing, setMissing] = useState(false)
  if (missing) return null
  return <img className="mmt-shot" src={url} alt={alt} loading="lazy" onError={() => setMissing(true)} />
}

export function MapMarkerTooltip({ marker, typeLabel, color, floor, item, boss }: MapMarkerTooltipProps) {
  const indoor = floor !== 'Основной'
  const shot = extractScreenshotUrl(marker)
  return (
    <div className="mmt" style={{ '--marker-color': color } as CSSProperties}>
      <div className="mmt-head">
        <span className="mmt-type"><span className="mmt-dot" />{uiText(typeLabel)}</span>
        <span className={`mmt-floor${indoor ? ' is-indoor' : ''}`}>
          {uiText(indoor ? <Building2 size={11} /> : <Layers size={11} />)}
          {uiText(floor)}
        </span>
      </div>

      {shot && <ExtractShot key={shot} url={shot} alt={uiText(marker.title)} />}

      {uiText(boss ? <BossBlock boss={boss} title={marker.title} guaranteed={marker.guaranteedSpawn === true} /> : (
        <div className="mmt-title-row">
          {uiText(item?.iconUrl && <img className="mmt-item-icon" src={item.iconUrl} alt={uiText("")} loading="lazy" />)}
          <div className="mmt-title-copy">
            <strong className="mmt-title">{uiText(marker.title)}</strong>
            {uiText(item && <span className="mmt-sub">{uiText(item.name)}</span>)}
          </div>
        </div>
      ))}

      {uiText(!boss && marker.guaranteedSpawn && <p className="mmt-meta mmt-guaranteed">{uiText(GUARANTEED_SPAWN_TEXT)}</p>)}
      {uiText(marker.possibleSpot && <PossibleSpotLine spot={marker.possibleSpot} />)}
      {uiText(marker.lock?.keycard && <KeycardLine keycard={marker.lock.keycard} />)}
      {uiText(marker.description && <p className="mmt-desc">{uiText(marker.description)}</p>)}
      {uiText(!boss && marker.meta && <p className="mmt-meta">{uiText(marker.meta)}</p>)}
      {uiText(marker.approximate && <p className="mmt-meta">{uiText("Точка приблизительная")}</p>)}
    </div>
  )
}

const possibleRing: CSSProperties = {
  width: 10, height: 10, flex: '0 0 auto', borderRadius: '50%', border: '1.5px dashed var(--marker-color)', boxSizing: 'border-box',
}

function PossibleSpotLine({ spot }: { spot: PossibleSpot }) {
  return (
    <p className="mmt-meta mmt-possible" style={{ color: 'var(--marker-color)', fontWeight: 700 }}>
      <span aria-hidden="true" style={possibleRing} />
      {uiText(possibleSpotText(spot))}
    </p>
  )
}

const KEYCARD_SWATCH: Record<KeycardColor, [string, string]> = {
  red: ['#d6403a', 'красная'], green: ['#4fae5a', 'зелёная'], blue: ['#3f78d8', 'синяя'], violet: ['#9a5bd6', 'фиолетовая'],
  yellow: ['#e2c23b', 'жёлтая'], black: ['#1b1b1b', 'чёрная'], 'blue-marking': ['#6fa7e6', 'с синей полосой'],
  residential: ['#b9c2c9', 'жилой блок'], access: ['#e7e2d0', 'доступ в Лабораторию'],
}

/** Keycard doors: a swatch in the card's colour next to «Ключ-карта: красная». */
function KeycardLine({ keycard }: { keycard: KeycardColor }) {
  const [color, label] = KEYCARD_SWATCH[keycard]
  return (
    <p className="mmt-meta mmt-lock">
      <span aria-hidden="true" style={{ width: 14, height: 9, flex: '0 0 auto', borderRadius: 2, border: '1px solid #cfd6d0', background: color }} />
      {uiText(`Ключ-карта: ${label}`)}
    </p>
  )
}

/** tarkov.dev portrait; our own bust when there is none, it is the generic silhouette, or it fails to load. */
function BossPortrait({ boss, title }: { boss: BossInfo; title: string }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const bust = bossBustFor(boss, title)
  const remote = boss.portraitUrl && boss.portraitUrl !== failedUrl && !(bust && isGenericPortrait(boss.portraitUrl)) ? boss.portraitUrl : undefined
  const src = remote ?? bust
  if (!src) return <span className="mmt-portrait is-empty" aria-hidden="true" />
  return <img className="mmt-portrait" src={src} alt={uiText(boss.name)} loading="lazy" onError={remote ? () => setFailedUrl(remote) : undefined} />
}

function BossBlock({ boss, title, guaranteed }: { boss: BossInfo; title: string; guaranteed: boolean }) {
  const chances = [
    // «Спавн 100 %» only when the marker says so (the loaded mode's data gives 100 % and no trigger is needed).
    guaranteed ? GUARANTEED_SPAWN_TEXT : boss.spawnChance != null ? `шанс ${percent(boss.spawnChance)}` : '',
    boss.locationChance != null && boss.locationChance < 1 ? `зона ${percent(boss.locationChance)}` : '',
  ].filter(Boolean)
  return (
    <div className="mmt-boss">
      <div className="mmt-boss-top">
        <BossPortrait boss={boss} title={title} />
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
