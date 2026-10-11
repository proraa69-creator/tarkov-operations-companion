import type { CSSProperties } from 'react'
import { Crown, Lock, Repeat, Store } from 'lucide-react'
import { cheapestOffer, offerAccess, type PurchaseAccess } from '../arsenal/buildStats'
import type { GunOffer, GunPart } from '../arsenal/gunTypes'
import type { Trader, WeaponBuildRequirement } from '../domain/types'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { formatPrice } from '../shared/format'
import { formatValue, attributeLabel } from './gunsmith'
import type { GunsmithPlan, PartAlternative } from './gunsmithSolver'
import { loyaltyNumeral } from './traderLevels'
import './shopping.css'

/**
 * «Что купить» as a picture table, like the wiki's (owner, 11.10.2026): the part in its inventory cells, its name, who
 * sells it — a small trader portrait with the loyalty level the offer needs (I, II, III, a crown for the top level) — and
 * the price the player pays now: from the trader when their loyalty is high enough, else on the flea when it is sold
 * there. Under a part: cheaper parts that keep every requirement met.
 */
interface ShoppingTableProps {
  plan: GunsmithPlan
  requirement: WeaponBuildRequirement
  access: PurchaseAccess
  traders: Map<string, Trader>
  questName?: (taskId: string) => string | undefined
  compact?: boolean
}

type Role = 'weapon' | 'required' | 'category' | 'build'

export function ShoppingTable({ plan, requirement, access, traders, questName, compact }: ShoppingTableProps) {
  const { locale } = useLocale()
  const categories = new Set((requirement.categories ?? []).map((category) => category.id))
  const required = new Set([...requirement.partIds, ...(requirement.anyOfIds ?? [])])
  const role = (part: GunPart): Role => required.has(part.id) ? 'required' : part.categoryIds?.some((id) => categories.has(id)) ? 'category' : 'build'
  // The whole rifle, not its base part: the default preset's picture (traders sell the weapon as that preset).
  const preset = plan.weapon.defaultPreset
  const weaponPart: GunPart = preset?.gridImageLink
    ? { ...plan.weapon, gridImageLink: preset.gridImageLink, width: preset.width ?? plan.weapon.width, height: preset.height ?? plan.weapon.height }
    : { ...plan.weapon, gridImageLink: undefined, iconLink: preset?.imageLink ?? plan.weapon.imageLink ?? plan.weapon.iconLink, width: preset?.width ?? 5, height: preset?.height ?? 2 }
  const rows: Array<{ part: GunPart; role: Role }> = [{ part: weaponPart, role: 'weapon' }, ...plan.toBuy.map((line) => ({ part: line.part, role: role(line.part) }))]
  const alternativesOf = new Map(plan.alternatives.map((entry) => [entry.part.id, entry.options]))
  const price = (part: GunPart) => cheapestOffer(part, access)?.priceRUB
  const partsTotal = plan.toBuy.reduce((sum, line) => sum + (price(line.part) ?? 0), 0)
  const missing = plan.toBuy.filter((line) => price(line.part) === undefined).length
  const weaponPrice = price(plan.weapon)

  return <div className={`gs-shop${compact ? ' is-compact' : ''}`}>
    {!compact && <div className="gs-shop-head" aria-hidden="true">
      <span>{uiText('Предмет')}</span>
      <span>{uiText('Модификация')}</span>
      <span>{uiText('Продавец')}</span>
      <span>{uiText('Цена')}</span>
    </div>}
    <ul className="gs-shop-rows">
      {rows.map(({ part, role: kind }, index) => <li key={`${part.id}-${index}`} className={`gs-shop-row is-${kind}`}>
        <ItemCells part={part} />
        <div className="gs-shop-name">
          <strong>{uiText(part.name)}</strong>
          <small>{uiText(roleText(kind, locale))}</small>
        </div>
        <Sellers part={part} access={access} traders={traders} questName={questName} />
        <PriceCell part={part} access={access} />
        {alternativesOf.get(part.id)?.length ? <Alternatives options={alternativesOf.get(part.id)!} access={access} traders={traders} /> : null}
      </li>)}
    </ul>
    <p className="gs-shop-total">
      <span>{uiText('Модули: ')}<strong>{formatPrice(partsTotal)}</strong></span>
      {weaponPrice !== undefined && <span>{uiText('Вместе с оружием: ')}<strong>{formatPrice(weaponPrice + partsTotal)}</strong></span>}
      {missing > 0 && <span className="gs-shop-missing">{locale === 'en' ? `${missing} not available to you yet` : `${missing} пока недоступно вам`}</span>}
    </p>
  </div>
}

function roleText(role: Role, locale: AppLocale) {
  if (locale === 'en') return role === 'weapon' ? 'the task’s weapon (default build)' : role === 'required' ? 'required by the task' : role === 'category' ? 'a part of the required category' : 'for the stats or to fit a part'
  return role === 'weapon' ? 'оружие задания (стандартная сборка)' : role === 'required' ? 'обязательный модуль' : role === 'category' ? 'деталь нужной категории' : 'для характеристик или крепления'
}

/** The part in its inventory cells (tarkov.dev grid image, w × h cells), like the game and the wiki. */
export function ItemCells({ part, small }: { part: Pick<GunPart, 'gridImageLink' | 'iconLink' | 'width' | 'height' | 'shortName'>; small?: boolean }) {
  const width = Math.min(Math.max(part.width ?? 1, 1), 6)
  const height = Math.min(Math.max(part.height ?? 1, 1), 3)
  const image = part.gridImageLink ?? part.iconLink
  return <span className={`gs-cells${small ? ' is-small' : ''}`} style={{ '--w': width, '--h': height } as CSSProperties}>
    {image ? <img src={image} alt="" loading="lazy" /> : null}
    {!part.gridImageLink && <span className="gs-cells-label">{part.shortName}</span>}
  </span>
}

/** A trader portrait with the loyalty level (I, II, III, crown), dimmed when the player's level is lower. */
export function TraderBadge({ trader, name, image, level, locked, chosen, title, small, barter }: { trader?: Trader; name: string; image?: string; level?: number; locked?: boolean; chosen?: boolean; title?: string; small?: boolean; barter?: boolean }) {
  const picture = trader?.imageUrl ?? image
  return <span className={`gs-trader${locked ? ' is-locked' : ''}${chosen ? ' is-chosen' : ''}${small ? ' is-small' : ''}`} title={title ?? name}>
    {picture ? <img src={picture} alt="" loading="lazy" /> : <span className="gs-trader-initial">{name.slice(0, 1)}</span>}
    {level ? <span className="gs-trader-level" aria-label={`LL${level}`}>{level >= 4 ? <Crown size={small ? 8 : 9} strokeWidth={2.5} aria-hidden="true" /> : loyaltyNumeral(level)}</span> : null}
    {locked && <span className="gs-trader-lock" aria-hidden="true"><Lock size={small ? 8 : 9} /></span>}
    {barter && <span className="gs-trader-barter" aria-hidden="true"><Repeat size={small ? 8 : 9} strokeWidth={2.5} /></span>}
  </span>
}

export function FleaBadge({ locked, chosen, title, small }: { locked?: boolean; chosen?: boolean; title: string; small?: boolean }) {
  return <span className={`gs-trader is-flea${locked ? ' is-locked' : ''}${chosen ? ' is-chosen' : ''}${small ? ' is-small' : ''}`} title={title}>
    <Store size={small ? 12 : 15} aria-hidden="true" />
  </span>
}

function offerTitle(offer: GunOffer, part: GunPart, access: PurchaseAccess, locale: AppLocale, questName?: (taskId: string) => string | undefined) {
  const state = offerAccess(offer, part, access)
  const price = formatPrice(offer.priceRUB)
  if (offer.vendor === 'flea-market') {
    if (state.ok) return locale === 'en' ? `Flea market · ${price}` : `Барахолка · ${price}`
    return locale === 'en' ? `Flea market · ${price} · opens at level 15` : `Барахолка · ${price} · откроется с 15 уровня`
  }
  const level = offer.minTraderLevel ?? 1
  const task = offer.taskUnlock ? questName?.(offer.taskUnlock.id) ?? offer.taskUnlock.name : undefined
  const base = locale === 'en' ? `${offer.vendorName} · loyalty ${level} · ${price}` : `${offer.vendorName} · уровень лояльности ${level} · ${price}`
  const after = task ? (locale === 'en' ? ` · after the task «${task}»` : ` · после задания «${task}»`) : ''
  if (state.ok) return base + after
  if (!state.ok && state.reason === 'level') return base + after + (locale === 'en' ? ` · you have ${state.level}` : ` · у вас ${state.level}`)
  return base + after + (locale === 'en' ? ' · the task is not done yet' : ' · задание ещё не выполнено')
}

function Sellers({ part, access, traders, questName }: { part: GunPart; access: PurchaseAccess; traders: Map<string, Trader>; questName?: (taskId: string) => string | undefined }) {
  const { locale } = useLocale()
  const chosen = cheapestOffer(part, access)
  const traderOffers = part.offers.filter((offer) => offer.vendor !== 'flea-market').sort((a, b) => (a.minTraderLevel ?? 1) - (b.minTraderLevel ?? 1) || a.priceRUB - b.priceRUB)
  const flea = part.noFlea ? undefined : part.offers.find((offer) => offer.vendor === 'flea-market')
  const lockedTrader = traderOffers.find((offer) => !offerAccess(offer, part, access).ok)
  const note = !chosen
    ? (lockedTrader ? (locale === 'en' ? `needs loyalty ${lockedTrader.minTraderLevel ?? 1}` : `нужен уровень ${lockedTrader.minTraderLevel ?? 1}`) : (locale === 'en' ? 'barter or craft only' : 'только бартер или крафт'))
    : chosen.vendor === 'flea-market' && lockedTrader ? (locale === 'en' ? 'trader later, flea now' : 'у торговца позже — пока барахолка') : part.noFlea ? (locale === 'en' ? 'not on the flea' : 'нет на барахолке') : ''
  return <div className="gs-shop-sellers">
    <div className="gs-shop-badges">
      {traderOffers.map((offer, index) => {
        const ok = offerAccess(offer, part, access).ok
        return <TraderBadge key={`${offer.vendor}-${offer.minTraderLevel ?? 1}-${index}`} trader={traders.get(offer.vendor)} name={offer.vendorName} image={offer.traderImage} level={offer.minTraderLevel ?? 1}
          locked={!ok} chosen={offer === chosen} title={offerTitle(offer, part, access, locale, questName)} />
      })}
      {flea && <FleaBadge locked={!offerAccess(flea, part, access).ok} chosen={flea === chosen} title={offerTitle(flea, part, access, locale, questName)} />}
    </div>
    {note && <small className={chosen ? '' : 'is-warning'}>{note}</small>}
  </div>
}

function PriceCell({ part, access }: { part: GunPart; access: PurchaseAccess }) {
  const chosen = cheapestOffer(part, access)
  const best = part.offers.filter((offer) => offer.vendor !== 'flea-market' || !part.noFlea).reduce<GunOffer | undefined>((min, offer) => !min || offer.priceRUB < min.priceRUB ? offer : min, undefined)
  return <div className="gs-shop-price">
    <b>{chosen ? formatPrice(chosen.priceRUB) : '—'}</b>
    {chosen && best && best.priceRUB < chosen.priceRUB && <small title={uiText('Дешевле, когда откроется')}>{formatPrice(best.priceRUB)}</small>}
  </div>
}

function Alternatives({ options, access, traders }: { options: PartAlternative[]; access: PurchaseAccess; traders: Map<string, Trader> }) {
  const { locale } = useLocale()
  return <div className="gs-shop-alts">
    <span className="gs-shop-alts-title">{uiText('Дешевле, требования выполняются:')}</span>
    {options.map((option) => {
      const offer = cheapestOffer(option.part, access)
      const values = option.values.map((value) => `${attributeLabel(value.attribute.name, locale)} ${formatValue(value.attribute.name, value.actual, locale)}`).join(' · ')
      return <span key={option.part.id} className="gs-shop-alt" title={`${option.part.name}${values ? ` — ${values}` : ''}`}>
        <ItemCells part={option.part} small />
        <span className="gs-shop-alt-name">{uiText(option.part.shortName || option.part.name)}</span>
        {offer && (offer.vendor === 'flea-market'
          ? <FleaBadge small chosen title={locale === 'en' ? 'Flea market' : 'Барахолка'} />
          : <TraderBadge small chosen trader={traders.get(offer.vendor)} name={offer.vendorName} image={offer.traderImage} level={offer.minTraderLevel ?? 1} />)}
        <b>{offer ? formatPrice(offer.priceRUB) : '—'}</b>
        <em>−{formatPrice(option.saving)}</em>
        {values && <small>{values}</small>}
      </span>
    })}
  </div>
}
