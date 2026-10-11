import { useMemo, useState } from 'react'
import { Check, CircleHelp, Crosshair, X } from 'lucide-react'
import type { PurchaseAccess } from '../arsenal/buildStats'
import type { GunPart } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { attributeHint, attributeLabel, formatTarget, formatValue } from './gunsmith'
import type { AttributeCheck, GunsmithPlan } from './gunsmithSolver'
import { BuildImage } from './BuildImage'
import { buildScreenshot } from './buildScreenshots'
import { BuildPartCards, type ModsStatus } from './BuildPartCards'
import './gunsmith.css'

interface WeaponBuildDetailsProps {
  build: WeaponBuildRequirement
  /** The task (tarkov.dev id): its build has the owner's own screenshot (src/gunsmith/buildScreenshots.ts). */
  questId?: string
  /** The example build's values next to the targets (src/gunsmith/gunsmithSolver.ts). */
  checks?: AttributeCheck[]
  /** The Overview block: smaller picture, no hints. */
  compact?: boolean
  /** The whole weapon (its default preset's picture from the mod data), better than the base item's. */
  weaponImage?: string
  /** tarkov.dev's mod data (trader offers of each part), when loaded. */
  mods?: Map<string, GunPart>
  /** The player's trader levels: an offer above them is shown locked. */
  access?: PurchaseAccess
  /** The example build: its fitting alternatives fill the module cards' hover window. */
  plan?: GunsmithPlan | null
  modsStatus?: ModsStatus
}

/**
 * What a Gunsmith part asks for, like tarkov.dev's task page but in the app's words: the weapon with its picture, the
 * stats (every one named — «Эффективная дальность», not «effectiveDistance») and the parts it must hold, with pictures
 * and the flea price.
 */
export function WeaponBuildDetails({ build, questId, checks, compact, weaponImage, mods, access, plan, modsStatus }: WeaponBuildDetailsProps) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const weapon = items.get(build.weaponId)
  // The whole rifle: the default preset's picture (the base item alone is only its receiver).
  const image = weaponImage ?? weapon?.presetImageUrl ?? weapon?.iconUrl
  // The finished build: the owner's own screenshot, else the guide's. One that does not load (owner, 11.10.2026: «ни одна
  // картинка не открывается») gives way to the next, the last to the weapon.
  const [failedImages, setFailedImages] = useState<string[]>([])
  const buildImage = [buildScreenshot(questId, build.weaponId), build.guide?.image].find((src) => src && !failedImages.includes(src))
  const fromGuide = buildImage !== undefined && buildImage === build.guide?.image
  return <div className={`gs-build${compact ? ' is-compact' : ''}`}>
    <figure className={`gs-weapon${buildImage ? ' has-build-image' : ''}`}>
      {/* The finished build (the game's «Сборки оружия» screen), else the weapon's default preset. */}
      {buildImage
        ? <BuildImage key={buildImage} src={buildImage} alt={uiText(weapon?.name ?? 'Оружие из задания')} onError={() => setFailedImages((failed) => [...failed, buildImage])} />
        : image ? <img src={image} alt={uiText(weapon?.name ?? '')} loading="lazy" /> : <span className="gs-weapon-empty"><Crosshair size={28} /></span>}
      <figcaption>
        <strong>{uiText(weapon?.name ?? 'Оружие из задания')}</strong>
        {weapon?.shortName && weapon.shortName !== weapon.name && <small>{weapon.shortName}</small>}
        {fromGuide && build.guide?.source === 'tarkov.help' && <small className="gs-weapon-credit">{uiText('Готовая сборка: tarkov.help')}</small>}
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

    <BuildPartCards build={build} compact={compact} mods={mods} access={access} plan={plan} modsStatus={modsStatus} />
    {build.categories?.length ? <div className="gs-block">
      <h5>{uiText('Деталь из категории')}</h5>
      <div className="gs-categories">{build.categories.map((category) => <span className="tag" key={category.id}>{uiText(category.name)}</span>)}</div>
    </div> : null}
  </div>
}
