import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleHelp, Crosshair, Package, X } from 'lucide-react'
import type { WeaponBuildRequirement } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { displayPrice } from '../domain/itemPrices'
import { formatPrice } from '../shared/format'
import { attributeHint, attributeLabel, formatTarget, formatValue } from './gunsmith'
import type { AttributeCheck } from './gunsmithSolver'
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
}

/**
 * What a Gunsmith part asks for, like tarkov.dev's task page but in the app's words: the weapon with its picture, the
 * stats (every one named — «Эффективная дальность», not «effectiveDistance») and the parts it must hold, with pictures
 * and the flea price.
 */
export function WeaponBuildDetails({ build, checks, compact, weaponImage, hideParts }: WeaponBuildDetailsProps) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const mode = useAppState().raidMode
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const weapon = items.get(build.weaponId)
  // The whole rifle: the default preset's picture (the base item alone is only its receiver).
  const image = weaponImage ?? weapon?.presetImageUrl ?? weapon?.iconUrl
  const parts = build.partIds.map((id) => ({ id, item: items.get(id) }))
  const anyOf = (build.anyOfIds ?? []).map((id) => ({ id, item: items.get(id) }))

  const partCard = ({ id, item }: { id: string; item?: (typeof data.items)[number] }) => {
    const price = item ? displayPrice(item, mode) : undefined
    return <Link className="gs-part" key={id} to={`/flea?selected=${id}`} title={uiText(item?.name ?? '')}>
      {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="gs-part-empty"><Package size={18} /></span>}
      <span>
        <strong>{uiText(item?.shortName ?? item?.name ?? id)}</strong>
        {!compact && <small>{uiText(item?.name ?? '')}</small>}
        <small className="gs-part-price">{uiText(price?.kind === 'flea' ? formatPrice(price.price) : 'нет на барахолке')}</small>
      </span>
    </Link>
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
    {build.categories?.length ? <div className="gs-block">
      <h5>{uiText('Деталь из категории')}</h5>
      <div className="gs-categories">{build.categories.map((category) => <span className="tag" key={category.id}>{uiText(category.name)}</span>)}</div>
    </div> : null}
  </div>
}
