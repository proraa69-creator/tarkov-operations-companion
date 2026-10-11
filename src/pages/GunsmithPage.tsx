import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, Lock, Trophy, Wrench } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { calculateAvailability } from '../progression/requirementEngine'
import { gunsmithSteps, gunsmithSummary, stepStatus, type GunsmithStep } from '../gunsmith/gunsmith'
import { WeaponBuildDetails } from '../gunsmith/WeaponBuildDetails'
import { solveGunsmithBuild, type GunsmithPlan } from '../gunsmith/gunsmithSolver'
import { useGunCatalog } from '../arsenal/gunCatalog'
import type { BuildNode, GunCatalog, GunOffer, GunPart } from '../arsenal/gunTypes'
import { formatPrice } from '../shared/format'
import type { WeaponBuildRequirement } from '../domain/types'
import '../gunsmith/gunsmith.css'

/**
 * «Оружейник → Посмотреть все» (owner, 10.10.2026): every Gunsmith part in order, each with its weapon, the stats and
 * parts it needs, an example build (what to buy, from whom, for how much) and the rewards. Not in the menu: opened from
 * the Overview block. Data: the live catalog (tasks) and the weapon builder's tarkov.dev part data (slots, stats, offers).
 */
export function GunsmithPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const progress = state.activeProfile.modes[state.raidMode]
  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const steps = useMemo(() => gunsmithSteps(data.quests, (id) => availability.get(id)?.status), [availability, data.quests])
  const summary = gunsmithSummary(steps)
  const requested = Number(params.get('part'))
  const fallback = summary.active[0] ?? summary.next ?? steps[0]
  const selected = steps.find((step) => step.part === requested) ?? fallback
  const select = (part: number) => setParams((current) => { const next = new URLSearchParams(current); next.set('part', String(part)); return next }, { replace: true })

  return <div className="page gunsmith-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Механик · ')}{uiText(state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase())}</div>
        <h1 className="page-title">{uiText('Оружейник')}</h1>
        <p className="page-subtitle">{uiText('Все части цепочки: оружие, обязательные модули, характеристики и пример сборки. Данные tarkov.dev обновляются вместе с базой заданий.')}</p>
      </div>
      <div className="gunsmith-page-actions">
        <span className="tag green"><Check size={12} /> {uiText(`Выполнено ${summary.done} из ${summary.total}`)}</span>
        <Link to="/" className="button ghost"><ArrowLeft size={15} />{uiText(' Обзор')}</Link>
      </div>
    </header>

    {!steps.length
      ? <section className="panel"><div className="panel-body"><p className="muted">{uiText('Задания «Оружейник» не найдены в базе заданий этого режима.')}</p></div></section>
      : <div className="gunsmith-layout">
        <section className="panel gunsmith-list">
          <div className="panel-header"><div className="panel-title"><Wrench size={15} aria-hidden="true" /> {uiText('Части')}</div></div>
          <ol className="gunsmith-parts">
            {steps.map((step) => <li key={step.part}>
              <PartRow step={step} selected={step.part === selected?.part} playerLevel={progress.playerLevel} onSelect={() => select(step.part)} />
            </li>)}
          </ol>
        </section>
        {selected && <PartDetail key={selected.part} step={selected} playerLevel={progress.playerLevel} />}
      </div>}
  </div>
}

function PartRow({ step, selected, playerLevel, onSelect }: { step: GunsmithStep; selected: boolean; playerLevel: number; onSelect: () => void }) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const weapon = step.build ? data.items.find((item) => item.id === step.build!.weaponId) : undefined
  return <button type="button" className={`gunsmith-part-row is-${step.status}${selected ? ' is-selected' : ''}`} aria-current={selected || undefined} onClick={onSelect}>
    <span className="gunsmith-part-index">{step.status === 'completed' ? <Check size={12} aria-hidden="true" /> : step.part}</span>
    {weapon?.presetImageUrl || weapon?.iconUrl ? <img className="gunsmith-part-thumb" src={weapon.presetImageUrl ?? weapon.iconUrl} alt="" loading="lazy" /> : <span className="gunsmith-part-thumb" />}
    <span className="gunsmith-part-copy">
      <strong>{uiText(step.quest.name)}</strong>
      <small>{uiText(weapon?.shortName ?? '')}{weapon ? ' · ' : ''}{uiText(`ур. ${step.quest.level}`)}</small>
    </span>
    <span className="gunsmith-part-status">{step.status === 'locked' && <Lock size={10} aria-hidden="true" />}{stepStatus(step, playerLevel, locale)}</span>
  </button>
}

function PartDetail({ step, playerLevel }: { step: GunsmithStep; playerLevel: number }) {
  const { quest, build } = step
  const { locale } = useLocale()
  const description = quest.objectiveDetails?.find((objective) => objective.build)?.description
  return <section className="panel detail-panel gunsmith-detail">
    <div className="detail-hero">
      <div className="eyebrow">{uiText(quest.trader)} · {uiText(`уровень ${quest.level}`)}</div>
      <h2>{uiText(quest.name)}</h2>
      <div className="quest-full-tags"><span className={`tag ${step.status === 'completed' ? 'green' : step.status === 'active' ? 'brass' : ''}`}>{stepStatus(step, playerLevel, locale)}</span>{quest.kappa && <span className="tag brass">{uiText('капа')}</span>}</div>
    </div>
    {description && <div className="detail-section"><h4>{uiText('Задача')}</h4><p>{uiText(description)}</p></div>}
    {build
      ? <ExampleBuild build={build} />
      : <div className="detail-section"><p className="dim">{uiText('Подробных требований к сборке в данных пока нет.')}</p></div>}
    <div className="detail-section">
      <h4>{uiText('Награды')}</h4>
      {quest.rewards.length
        ? <div className="quest-full-rewards">{quest.rewards.map((reward) => <span key={reward}><Trophy size={14} />{uiText(reward)}</span>)}</div>
        : <p className="dim">{uiText('Награды на Wiki не указаны.')}</p>}
    </div>
    {quest.wikiLink && <div className="detail-section"><a className="button ghost" href={quest.wikiLink} target="_blank" rel="noreferrer"><ExternalLink size={15} />{uiText(' Страница на Wiki')}</a></div>}
  </section>
}

/** Requirements with the example build's values next to them, then what to buy and the whole build. */
function ExampleBuild({ build }: { build: WeaponBuildRequirement }) {
  const state = useAppState()
  const { locale } = useLocale()
  const catalog = useGunCatalog(state.raidMode, locale)
  // The search takes up to a second on the full mod list: it runs after the page has painted «Подбираю сборку…».
  const [result, setResult] = useState<{ build: WeaponBuildRequirement; catalog: GunCatalog; plan: GunsmithPlan | null } | null>(null)
  useEffect(() => {
    const data = catalog.data
    if (!data) return
    const timer = window.setTimeout(() => setResult({ build, catalog: data, plan: solveGunsmithBuild(build, data) }), 30)
    return () => window.clearTimeout(timer)
  }, [build, catalog.data])
  const plan = result && result.build === build && result.catalog === catalog.data ? result.plan : undefined
  return <>
    <div className="detail-section"><WeaponBuildDetails build={build} checks={plan?.checks} /></div>
    <div className="detail-section gunsmith-example">
      <h4>{uiText('Как собрать · пример сборки')}</h4>
      {(catalog.isLoading || (catalog.data && plan === undefined)) && <p className="dim">{uiText('Подбираю сборку по актуальным данным модулей…')}</p>}
      {!catalog.isLoading && !catalog.data && <p className="dim">{uiText('Данные модулей сейчас недоступны — попробуйте позже.')}</p>}
      {catalog.data && plan === null && <p className="dim">{uiText('Этого оружия нет в данных модулей: соберите по требованиям выше.')}</p>}
      {catalog.data && plan && <PlanView plan={plan} catalog={catalog.data} />}
    </div>
  </>
}

function offerText(offer: GunOffer | undefined) {
  if (!offer) return 'не продаётся — бартер или крафт'
  return offer.vendor === 'flea-market' ? 'Барахолка' : `${offer.vendorName} · ур. ${offer.minTraderLevel ?? 1}`
}

function PlanView({ plan, catalog }: { plan: GunsmithPlan; catalog: GunCatalog }) {
  const weaponLine = plan.cost.lines[0]
  const partsTotal = plan.toBuy.reduce((sum, line) => sum + (line.offer?.priceRUB ?? 0), 0)
  const unplaced = plan.unplaced.map((id) => catalog.mods.get(id)?.name ?? id)
  const missed = plan.checks.filter((check) => check.met === false)
  const tree = buildRows(plan, catalog)
  return <div className="gunsmith-plan">
    {missed.length > 0 && <p className="gunsmith-warning">{uiText('Пример не дотягивает до всех характеристик: подберите другие модули в игре, следя за показателями при осмотре оружия.')}</p>}
    {unplaced.length > 0 && <p className="gunsmith-warning">{uiText('Не нашли, куда поставить: ')}{unplaced.map((name) => uiText(name)).join(', ')}</p>}

    <h5>{uiText('Что купить')}</h5>
    <ul className="gunsmith-buy">
      {weaponLine && <BuyRow part={weaponLine.part} offer={weaponLine.offer} note={uiText('оружие')} />}
      {plan.toBuy.map((line, index) => <BuyRow key={`${line.part.id}-${index}`} part={line.part} offer={line.offer} />)}
    </ul>
    <p className="gunsmith-total">
      <span>{uiText('Модули: ')}<strong>{formatPrice(partsTotal)}</strong></span>
      {weaponLine?.offer && <span>{uiText('Вместе с оружием: ')}<strong>{formatPrice(weaponLine.offer.priceRUB + partsTotal)}</strong></span>}
    </p>

    <h5>{uiText('Сборка целиком')}</h5>
    <ul className="gunsmith-tree">
      {tree.map((row) => <li key={row.key} style={{ paddingLeft: `${row.depth * 14}px` }} className={row.bought ? 'is-bought' : ''}>
        <span className="gunsmith-tree-slot">{uiText(row.slot)}</span>
        <span className="gunsmith-tree-part">{row.part.iconLink && <img src={row.part.iconLink} alt="" loading="lazy" />}{uiText(row.part.shortName || row.part.name)}</span>
      </li>)}
    </ul>
    <p className="dim gunsmith-note">{uiText('Сборка подобрана автоматически по данным tarkov.dev. Перед сдачей проверьте характеристики в игре (осмотр оружия): игра считает их сама.')}</p>
  </div>
}

function BuyRow({ part, offer, note }: { part: GunPart; offer?: GunOffer; note?: string }) {
  return <li>
    {part.iconLink ? <img src={part.iconLink} alt="" loading="lazy" /> : <span className="gunsmith-buy-empty" />}
    <span><strong>{uiText(part.name)}</strong><small>{note ? `${note} · ` : ''}{uiText(offerText(offer))}</small></span>
    <b>{offer ? formatPrice(offer.priceRUB) : '—'}</b>
  </li>
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
