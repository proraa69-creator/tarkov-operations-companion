import { Crown, MapPin } from 'lucide-react'
import { tr } from '../../i18n'
import customsSatellite from '../../assets/promo/customs-satellite.webp'
import goldenEgg from '../../assets/promo/golden-egg.webp'
import './itemMap.css'

/**
 * The item and the player's place on one picture, on the PC and on the phone (owner, 09–10.11.2026: «золотое яйцо… ближе
 * к надписи таможни, настоящая карта таможни спутник, и точка на карте… местоположение и информация о предмете в
 * приложении на ПК и телефоне»; «не интерактивное, просто картинками»). The satellite picture is the app's own Customs
 * tiles stitched (raidos.app/v1/map-tiles, tarkov.dev's render), the egg is tarkov.dev's item picture.
 */
const POINT = { x: 47.5, y: 39 }

function ItemCard({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`imap-card${compact ? ' is-compact' : ''}`}>
      <div className="imap-item">
        <img src={goldenEgg} alt="" width={84} height={84} />
        <div>
          <strong>{tr('Золотое яйцо')}</strong>
          <span className="imap-kappa"><Crown size={12} aria-hidden="true" />{tr('Нужно для Каппы')}</span>
        </div>
      </div>
      <dl className="imap-prices">
        <div><dt>{tr('Барахолка')}</dt><dd>34 516 ₽</dd></div>
        <div><dt>{tr('Терапевт')}</dt><dd>34 680 ₽</dd></div>
      </dl>
      <div className="imap-where">
        <MapPin size={15} aria-hidden="true" />
        <div>
          <strong>{tr('Вы здесь')}</strong>
          <span>{tr('Таможня · Стройка · уровень земли')}</span>
        </div>
      </div>
    </div>
  )
}

function SatelliteMap({ label = true }: { label?: boolean }) {
  return (
    <div className="imap-map">
      <img src={customsSatellite} alt="" width={1800} height={956} loading="lazy" decoding="async" />
      {label && <span className="imap-label">{tr('Таможня')}</span>}
      <span className="imap-point" style={{ left: `${POINT.x}%`, top: `${POINT.y}%` }} aria-hidden="true"><i className="imap-cone" /><i className="imap-dot" /></span>
    </div>
  )
}

export function ItemMapVisual() {
  return (
    <figure className="promo-figure imap-duo" role="img" aria-label={tr('Карточка золотого яйца и ваша точка на спутниковой карте Таможни — в приложении на ПК и в телефоне')}>
      <div className="imap-pc" aria-hidden="true">
        <div className="imap-bar"><i /><i /><i /><span>{tr('Raid OS · Карты · Таможня')}</span></div>
        <div className="imap-pc-body">
          <SatelliteMap />
          <ItemCard />
          <span className="imap-attr">{tr('Карта © tarkov.dev')}</span>
        </div>
      </div>
      <div className="imap-phone" aria-hidden="true">
        <SatelliteMap label={false} />
        <ItemCard compact />
      </div>
    </figure>
  )
}
