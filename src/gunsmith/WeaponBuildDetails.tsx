import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleHelp, Crosshair, Package, X } from 'lucide-react'
import type { PurchaseAccess } from '../arsenal/buildStats'
import type { GunPart } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { displayPrice } from '../domain/itemPrices'
import { formatPrice } from '../shared/format'
import { attributeHint, attributeLabel, formatTarget, formatValue } from './gunsmith'
import type { AttributeCheck } from './gunsmithSolver'
import { partSellers, type PartSeller } from './partSellers'
import { TraderBadge } from './ShoppingTable'
import { traderKey } from './traderLevels'
import './gunsmith.css'

interface WeaponBuildDetailsProps {
  build: WeaponBuildRequirement
  /** The example build's values next to the targets (src/gunsmith/gunsmithSolver.ts). */
  checks?: AttributeCheck[]
  /** The Overview block: smaller picture, no hints. */
  compact?: boolean
  /** The whole weapon (its default preset's picture from the mod data), better than the base item's. */
  weaponImage?: string
  /** The required parts are listed in «Что купить» with pictures and prices already. */
  hideParts?: boolean
  /** tarkov.dev's mod data (trader offers of each part), when loaded. */
  mods?: Map<string, GunPart>
  /** The player's trader levels: an offer above them is shown locked. */
  access?: PurchaseAccess
}

/**
 * What a Gunsmith part asks for, like tarkov.dev's task page but in the app's words: the weapon with its picture, the
 * stats (every one named — «Эффективная дальность», not «effectiveDistance») and the parts it must hold, with pictures
 * and the flea price.
 */
export function WeaponBuildDetails({ build, checks, compact, weaponImage, hideParts, mods, access }: WeaponBuildDetailsProps) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const mode = useAppState().raidMode
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const weapon = items.get(build.weaponId)
  // The whole rifle: the default preset's picture (the base item alone is only its receiver).
  const image = weaponImage ?? weapon?.presetImageUrl ?? weapon?.iconUrl
  const parts = build.partIds.map((id) => ({ id, item: items.get(id) }))
  const anyOf = (build.anyOfIds ?? []).map((id) => ({ id, item: items.get(id) }))
  // The rest of the wiki's build (the parts the task does not check by item, src/data/wikiGunsmith.ts).
  const listed = new Set([...build.partIds, ...(build.anyOfIds ?? [])])
  const wikiBuild = (build.wikiParts ?? []).filter((part) => !part.itemId || !listed.has(part.itemId))
  const sellers = useMemo(() => partSellers(build, mods), [build, mods])
  const traders = useMemo(() => new Map((data.traders ?? []).map((trader) => [traderKey(trader), trader])), [data.traders])

  const sellerBadges = (list: PartSeller[] | undefined) => list?.length ? <span className="gs-part-sellers">
    {list.slice(0, 3).map((seller) => {
      const trader = traders.get(seller.trader)
      const name = trader?.name ?? seller.trader
      const have = access?.traderLevels?.[seller.trader]
      const locked = have !== undefined && have < seller.level
      const title = locale === 'en'
        ? `${name}: loyalty ${seller.level}${seller.barter ? ', barter' : ''}${locked ? ` (you have ${have})` : ''}`
        : `${name}: уровень ${seller.level}${seller.barter ? ', бартер' : ''}${locked ? ` (у вас ${have})` : ''}`
      return <TraderBadge key={`${seller.trader}-${seller.level}-${seller.barter ? 'b' : 'c'}`} trader={trader} name={name} level={seller.level} barter={seller.barter} locked={locked} title={title} small />
    })}
  </span> : null

  const partCard = ({ id, item, name }: { id?: string; item?: (typeof data.items)[number]; name?: string }) => {
    const price = item ? displayPrice(item, mode) : undefined
    const body = <>
      {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="gs-part-empty"><Package size={18} /></span>}
      <span>
        <strong>{uiText(item?.shortName ?? item?.name ?? name ?? id ?? '')}</strong>
        {!compact && <small>{uiText(item?.name ?? (item ? '' : name ?? ''))}</small>}
        <small className="gs-part-price">{uiText(price?.kind === 'flea' ? formatPrice(price.price) : 'нет на барахолке')}</small>
      </span>
      {id && sellerBadges(sellers.get(id))}
    </>
    return id
      ? <Link className="gs-part" key={id} to={`/flea?selected=${id}`} title={uiText(item?.name ?? '')}>{body}</Link>
      : <span className="gs-part" key={name}>{body}</span>
  }

  return <div className={`gs-build${compact ? ' is-compact' : ''}`}>
    <figure className="gs-weapon">
      {image ? <img src={image} alt={uiText(weapon?.name ?? '')} loading="lazy" /> : <span className="gs-weapon-empty"><Crosshair size={28} /></span>}
      <figcaption>
        <strong>{uiText(weapon?.name ?? 'Оружие из задания')}</strong>
        {weapon?.shortName && weapon.shortName !== weapon.name && <small>{weapon.shortName}</small>}
      </figcaption>
    </figure>

    {build.attributes.length > 0 && <div className="gs-block">
      <h5>{uiText('Характеристики')}</h5>
      <ul className="gs-stats">
        {build.attributes.map((attribute) => {
          const check = checks?.find((entry) => entry.attribute === attribute || (entry.attribute.name === attribute.name && entry.attribute.compare === attribute.compare && entry.attribute.value === attribute.value))
          const hint = !compact && check && check.actual === undefined ? attributeHint(attribute.name, locale) : undefined
          return <li key={`${attribute.name}${attribute.compare}${attribute.value}`} className={check ? check.met === undefined ? 'is-unknown' : check.met ? 'is-met' : 'is-missed' : ''}>
            <span className="gs-stat-name">{attributeLabel(attribute.name, locale)}</span>
            <strong className="gs-stat-target">{formatTarget(attribute, locale)}</strong>
            {check && <span className="gs-stat-actual" title={uiText(check.actual === undefined ? 'Проверьте в игре' : 'В примере сборки')}>
              {check.actual === undefined
                ? <><CircleHelp size={13} aria-hidden="true" />{uiText('в игре')}</>
                : <>{check.met ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}{formatValue(attribute.name, check.actual, locale)}</>}
            </span>}
            {hint && <small className="gs-stat-hint">{hint}</small>}
          </li>
        })}
      </ul>
    </div>}

    {!hideParts && parts.length > 0 && <div className="gs-block">
      <h5>{uiText('Обязательные модули')}</h5>
      <div className="gs-parts">{parts.map(partCard)}</div>
    </div>}
    {!hideParts && anyOf.length > 0 && <div className="gs-block">
      <h5>{uiText('Один из модулей')}</h5>
      <div className="gs-parts">{anyOf.map(partCard)}</div>
    </div>}
    {(!compact || !hideParts) && wikiBuild.length > 0 && <div className="gs-block">
      <h5>{uiText('Сборка с вики · остальные модули')}</h5>
      <div className="gs-parts">{wikiBuild.map((part) => partCard({ id: part.itemId, item: part.itemId ? items.get(part.itemId) : undefined, name: part.name }))}</div>
    </div>}
    {build.categories?.length ? <div className="gs-block">
      <h5>{uiText('Деталь из категории')}</h5>
      <div className="gs-categories">{build.categories.map((category) => <span className="tag" key={category.id}>{uiText(category.name)}</span>)}</div>
    </div> : null}
  </div>
}
