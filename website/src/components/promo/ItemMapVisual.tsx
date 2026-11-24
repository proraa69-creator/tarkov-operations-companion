import { siteLocale, tr } from '../../i18n'
import itemPc from '../../assets/promo/item-pc.webp'
import itemPcEn from '../../assets/promo/item-pc-en.webp'
import itemPhone from '../../assets/promo/item-phone.webp'
import itemPhoneEn from '../../assets/promo/item-phone-en.webp'
import './itemMap.css'

const shot = (ru: string, en: string) => (siteLocale() === 'en' ? en : ru)

/**
 * «Информация о предмете в приложении на ПК и в телефоне» (owner, 10.11.2026: «в точности, как у нас в приложении… окно
 * в приложении на ПК с картой и окно в приложении на телефоне с картой и окном о предмете. И точка»): the app's own
 * «Карты» on the PC and on the phone — the recognised Golden egg card, the player's dot near «Стройка» on Customs, PMC
 * and Scav exits, the battle-pass documents and the points of the active quests.
 */
export function ItemMapVisual() {
  return (
    <figure className="promo-figure item-duo">
      <div className="shot item-duo-pc">
        <div className="shot-bar" aria-hidden="true"><i /><i /><i /><span>{tr('Raid OS · Карты · Таможня')}</span></div>
        <img src={shot(itemPc, itemPcEn)} width={1600} height={900} loading="lazy" decoding="async" alt={tr('Приложение на ПК: карта Таможни, карточка золотого яйца с ценами и пометкой «Каппа», точка игрока, выходы и квесты')} />
      </div>
      <div className="phone-frame item-duo-phone">
        <img src={shot(itemPhone, itemPhoneEn)} width={430} height={932} loading="lazy" decoding="async" alt={tr('Приложение на телефоне: та же карточка предмета и точка игрока на карте Таможни')} />
      </div>
    </figure>
  )
}
