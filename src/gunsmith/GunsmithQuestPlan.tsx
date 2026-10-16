import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useGunCatalog } from '../arsenal/gunCatalog'
import type { GunCatalog } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'
import { gunsmithHref } from './gunsmith'
import { solveGunsmithBuild, type GunsmithPlan } from './gunsmithSolver'
import { useGunsmithAccess } from './useGunsmithAccess'
import { WeaponBuildDetails } from './WeaponBuildDetails'
import './gunsmith.css'

/**
 * One weapon of a Gunsmith part: the finished build (the guide's screenshot), the stats it needs and the modules to put on
 * it — each with its traders and, on hover, the parts that fit instead. The mod data's example build (when loaded) only
 * feeds those alternatives and the stats' values. `compact`: the Overview block, with a link to the part's page.
 */
export function GunsmithQuestPlan({ build, questId, compact, weapon, showLink = true }: {
  build: WeaponBuildRequirement
  questId: string
  compact?: boolean
  /** A part that asks for several weapons: which one this is («Оружие 1 из 2»). */
  weapon?: { index: number; total: number }
  /** The Overview's «Как собрать» link (once, under the last weapon). */
  showLink?: boolean
}) {
  const state = useAppState()
  const { locale } = useLocale()
  const catalog = useGunCatalog(state.raidMode, locale)
  const shop = useGunsmithAccess()
  // The search takes up to a second on the full mod list: it runs after the panel has painted.
  const [result, setResult] = useState<{ build: WeaponBuildRequirement; catalog: GunCatalog; plan: GunsmithPlan | null } | null>(null)
  useEffect(() => {
    const data = catalog.data
    if (!data) return
    const timer = window.setTimeout(() => setResult({ build, catalog: data, plan: solveGunsmithBuild(build, data) }), 30)
    return () => window.clearTimeout(timer)
  }, [build, catalog.data])
  const plan = result && result.build === build && result.catalog === catalog.data ? result.plan : undefined
  const preset = plan?.weapon.defaultPreset
  const modsStatus = catalog.data ? 'ready' : catalog.isLoading ? 'loading' : 'unavailable'

  return <>
    {weapon && <p className={`gunsmith-weapon-count${compact ? ' is-compact' : ''}`}>{locale === 'en' ? `Weapon ${weapon.index + 1} of ${weapon.total}` : `Оружие ${weapon.index + 1} из ${weapon.total}`}</p>}
    <div className={compact ? 'gunsmith-quest-plan is-compact' : 'detail-section'}>
      <WeaponBuildDetails build={build} questId={questId} checks={plan?.checks} compact={compact} weaponImage={preset?.imageLink ?? plan?.weapon.imageLink} mods={catalog.data?.mods} access={shop.access} plan={plan} modsStatus={modsStatus}
        onRetryMods={() => void catalog.refetch()} />
    </div>
    {/* The Overview: a link to the part's page (owner, 11.10.2026: the page has no «Как собрать · пример сборки» section
        any more — the guide's finished build and its modules above are the build). */}
    {compact && showLink && <div className="gunsmith-example is-compact"><Link to={gunsmithHref({ id: questId })} className="button small gunsmith-how">{uiText('Как собрать')} <ChevronRight size={13} /></Link></div>}
  </>
}
