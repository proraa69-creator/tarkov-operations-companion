import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, ChevronRight, Lock, Wrench } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { gunsmithSummary, stepStatus, type GunsmithStep } from './gunsmith'
import { WeaponBuildDetails } from './WeaponBuildDetails'
import './gunsmith.css'

/**
 * «Оружейник» under «Текущие задания» on the Overview (owner, 10.10.2026): Mechanic's Gunsmith chain. The parts taken
 * in the game (from the logs) are listed here and nowhere else on the Overview; the strip shows the whole chain in
 * order — done, taken, next, locked. A part opens its weapon and required parts right here; «Посмотреть все» opens every
 * part with an example build (/gunsmith).
 */
export function GunsmithPanel({ steps, playerLevel }: { steps: GunsmithStep[]; playerLevel: number }) {
  const { locale } = useLocale()
  const summary = gunsmithSummary(steps)
  const featured = summary.active.length ? summary.active : summary.next ? [summary.next] : []
  const [openPart, setOpenPart] = useState<number | null>(null)
  const detailsId = useId()
  if (!steps.length) return null
  const open = openPart === null ? undefined : steps.find((step) => step.part === openPart)
  const toggle = (part: number) => setOpenPart((current) => current === part ? null : part)
  const doneLabel = locale === 'en' ? `${summary.done} of ${summary.total} done` : `выполнено ${summary.done} из ${summary.total}`

  return <section className="panel gunsmith-panel">
    <div className="panel-header">
      <div className="panel-title"><Wrench size={15} aria-hidden="true" /> {uiText('Оружейник')}</div>
      <Link to="/gunsmith" className="dim gunsmith-all">{uiText('Посмотреть все')} <ChevronRight size={13} /></Link>
    </div>
    <div className="panel-body">
      <div className="gunsmith-progress">
        <small>{uiText('Механик')} · {doneLabel}</small>
        <ol className="gunsmith-track" aria-label={uiText('Части цепочки «Оружейник»')}>
          {steps.map((step) => <li key={step.part}>
            <button type="button" className={`gunsmith-chip is-${step.status}${openPart === step.part ? ' is-open' : ''}`} aria-pressed={openPart === step.part} aria-controls={detailsId}
              title={`${uiText(step.quest.name)} · ${stepStatus(step, playerLevel, locale)}`} onClick={() => toggle(step.part)}>
              {step.status === 'completed' ? <Check size={11} aria-hidden="true" /> : step.part}
            </button>
          </li>)}
        </ol>
      </div>

      {summary.done === summary.total && summary.total > 0 && !summary.active.length && <p className="muted">{uiText('Вся цепочка «Оружейник» выполнена.')}</p>}
      {featured.map((step) => <div key={step.part} className={`quest-row gunsmith-row${openPart === step.part ? ' is-open' : ''}`}>
        <div className="quest-index">{String(step.part).padStart(2, '0')}</div>
        <button type="button" className="gunsmith-row-main" aria-expanded={openPart === step.part} aria-controls={detailsId} onClick={() => toggle(step.part)}>
          <strong>{uiText(step.quest.name)}</strong>
          <small>{step.status === 'active' ? uiText(`Механик · ур. ${step.quest.level}`) : `${uiText('Следующая часть')} · ${stepStatus(step, playerLevel, locale)}`}</small>
        </button>
        <ChevronDown size={15} className="gunsmith-row-chevron" aria-hidden="true" />
      </div>)}

      <div id={detailsId} className={`gunsmith-details${open ? ' is-open' : ''}`} inert={!open}>
        <div className="gunsmith-details-inner">
          {open && <>
            {!featured.includes(open) && <div className="gunsmith-details-title">
              <strong>{uiText(open.quest.name)}</strong>
              <small>{open.status === 'locked' && <Lock size={11} aria-hidden="true" />} {stepStatus(open, playerLevel, locale)}</small>
            </div>}
            {open.build
              ? <WeaponBuildDetails build={open.build} compact />
              : <p className="dim">{uiText('Подробных требований к сборке в данных пока нет.')}</p>}
            <Link className="button small gunsmith-how" to={`/gunsmith?part=${open.part}`}>{uiText('Как собрать')} <ChevronRight size={13} /></Link>
          </>}
        </div>
      </div>
    </div>
  </section>
}
