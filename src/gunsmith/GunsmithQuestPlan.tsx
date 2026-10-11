import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useGunCatalog } from '../arsenal/gunCatalog'
import type { BuildNode, GunCatalog, GunPart } from '../arsenal/gunTypes'
import type { WeaponBuildRequirement } from '../domain/types'
import { gunsmithHref } from './gunsmith'
import { solveGunsmithBuild, type GunsmithPlan } from './gunsmithSolver'
import { ItemCells, ShoppingTable } from './ShoppingTable'
import { TraderLevelsStrip } from './TraderLevelsStrip'
import { useGunsmithAccess } from './useGunsmithAccess'
import { WeaponBuildDetails } from './WeaponBuildDetails'
import './gunsmith.css'

/**
 * One Gunsmith part: the whole weapon, the stats it needs (with the example build's values), what to buy — the picture
 * table with traders, loyalty levels and cheaper alternatives — and, on the page, the player's trader levels and the
 * whole build. `compact`: the Overview block (no level strip, no tree; a link to the page).
 */
export function GunsmithQuestPlan({ build, questId, compact }: { build: WeaponBuildRequirement; questId: string; compact?: boolean }) {
  const state = useAppState()
  const { locale } = useLocale()
  const catalog = useGunCatalog(state.raidMode, locale)
  const shop = useGunsmithAccess()
  // The search takes up to a second on the full mod list: it runs after the panel has painted «Подбираю сборку…».
  const [result, setResult] = useState<{ build: WeaponBuildRequirement; catalog: GunCatalog; plan: GunsmithPlan | null } | null>(null)
  useEffect(() => {
    const data = catalog.data
    if (!data) return
    const timer = window.setTimeout(() => setResult({ build, catalog: data, plan: solveGunsmithBuild(build, data) }), 30)
    return () => window.clearTimeout(timer)
  }, [build, catalog.data])
  const plan = result && result.build === build && result.catalog === catalog.data ? result.plan : undefined
  const preset = plan?.weapon.defaultPreset

  return <>
    <div className={compact ? 'gunsmith-quest-plan is-compact' : 'detail-section'}>
      <WeaponBuildDetails build={build} checks={plan?.checks} compact={compact} weaponImage={preset?.imageLink ?? plan?.weapon.imageLink} hideParts={Boolean(plan)} />
    </div>
    <div className={compact ? 'gunsmith-example is-compact' : 'detail-section gunsmith-example'}>
      <h4>{uiText(compact ? 'Что купить' : 'Как собрать · пример сборки')}</h4>
      {(catalog.isLoading || (catalog.data && plan === undefined)) && <p className="dim">{uiText('Подбираю сборку по актуальным данным модулей…')}</p>}
      {!catalog.isLoading && !catalog.data && <p className="dim">{uiText('Данные модулей сейчас недоступны — попробуйте позже.')}</p>}
      {catalog.data && plan === null && <p className="dim">{uiText('Этого оружия нет в данных модулей: соберите по требованиям выше.')}</p>}
      {catalog.data && plan && <div className="gunsmith-plan">
        {!compact && <TraderLevelsStrip infos={shop.infos} mode={shop.mode} onSet={shop.setLevel} />}
        <Warnings plan={plan} catalog={catalog.data} />
        {!compact && <h5>{uiText('Что купить')}</h5>}
        <ShoppingTable plan={plan} requirement={build} access={shop.access} traders={shop.traders} questName={shop.questName} compact={compact} />
        {compact
          ? <p className="dim gunsmith-prices-note">{uiText('Цены — по вашим уровням торговцев.')}</p>
          : <>
            <h5>{uiText('Сборка целиком')}</h5>
            <ul className="gunsmith-tree">
              {buildRows(plan, catalog.data).map((row) => <li key={row.key} style={{ paddingLeft: `${row.depth * 14}px` }} className={row.bought ? 'is-bought' : ''}>
                <span className="gunsmith-tree-slot">{uiText(row.slot)}</span>
                <span className="gunsmith-tree-part"><ItemCells part={row.part} small />{uiText(row.part.shortName || row.part.name)}</span>
              </li>)}
            </ul>
          </>}
        <p className="dim gunsmith-note">{uiText('Сборка подобрана автоматически по данным tarkov.dev. Перед сдачей проверьте характеристики в игре (осмотр оружия): игра считает их сама.')}</p>
      </div>}
      {compact && <Link to={gunsmithHref({ id: questId })} className="button small gunsmith-how">{uiText('Как собрать')} <ChevronRight size={13} /></Link>}
    </div>
  </>
}

function Warnings({ plan, catalog }: { plan: GunsmithPlan; catalog: GunCatalog }) {
  const unplaced = plan.unplaced.map((id) => catalog.mods.get(id)?.name ?? id)
  const missed = plan.checks.filter((check) => check.met === false)
  return <>
    {missed.length > 0 && <p className="gunsmith-warning">{uiText('Пример не дотягивает до всех характеристик: подберите другие модули в игре, следя за показателями при осмотре оружия.')}</p>}
    {unplaced.length > 0 && <p className="gunsmith-warning">{uiText('Не нашли, куда поставить: ')}{unplaced.map((name) => uiText(name)).join(', ')}</p>}
  </>
}

/** The build as a tree: slot name, part, depth; parts to buy are marked. */
function buildRows(plan: GunsmithPlan, catalog: GunCatalog) {
  const bought = new Set(plan.toBuy.map((line) => line.part.id))
  const rows: Array<{ key: string; depth: number; slot: string; part: GunPart; bought: boolean }> = []
  const walk = (part: GunPart, node: BuildNode, depth: number, prefix: string) => {
    for (const slot of part.slots) {
      const child = node.children[slot.nameId]
      const childPart = child ? catalog.mods.get(child.itemId) : undefined
      if (!child || !childPart) continue
      const key = `${prefix}/${slot.nameId}`
      rows.push({ key, depth, slot: slot.name, part: childPart, bought: bought.has(childPart.id) })
      walk(childPart, child, depth + 1, key)
    }
  }
  walk(plan.weapon, plan.build.root, 0, '')
  return rows
}
