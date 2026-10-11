import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Wrench } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { gunsmithSummary, stepStatus, type GunsmithStep } from './gunsmith'
import { GunsmithQuestPlan } from './GunsmithQuestPlan'
import './gunsmith.css'

/**
 * «Оружейник» under «Текущие задания» on the Overview (owner, 10–11.10.2026): just the Gunsmith part that is current —
 * taken in the game (from the logs), else the next one — by name, no part numbers. A click opens it right here: the
 * whole weapon, the stats it needs, what to buy with pictures, traders and prices, and cheaper alternatives.
 * «Посмотреть все» (set like «N на Таможне» of the block above) opens every part (/gunsmith).
 */
export function GunsmithPanel({ steps, playerLevel }: { steps: GunsmithStep[]; playerLevel: number }) {
  const { locale } = useLocale()
  const summary = gunsmithSummary(steps)
  const current = summary.active.length ? summary.active : summary.next ? [summary.next] : []
  const [openPart, setOpenPart] = useState<number | null>(null)
  const baseId = useId()
  if (!steps.length) return null

  return <section className="panel gunsmith-panel">
    <div className="panel-header">
      <div className="panel-title"><Wrench size={15} aria-hidden="true" /> {uiText('Оружейник')}</div>
      <Link to="/gunsmith" className="panel-title current-tasks-where">{uiText('Посмотреть все')}</Link>
    </div>
    <div className="panel-body">
      {!current.length && <p className="muted">{uiText('Вся цепочка «Оружейник» выполнена.')}</p>}
      {current.map((step) => {
        const open = openPart === step.part
        const detailsId = `${baseId}-${step.part}`
        return <div key={step.part} className={`gunsmith-current${open ? ' is-open' : ''}`}>
          <button type="button" className="gunsmith-current-name" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpenPart(open ? null : step.part)}>
            <span>
              <strong>{uiText(step.quest.name)}</strong>
              {step.status !== 'active' && <small>{stepStatus(step, playerLevel, locale)}</small>}
            </span>
            <ChevronDown size={16} className="gunsmith-row-chevron" aria-hidden="true" />
          </button>
          <div id={detailsId} className={`gunsmith-details${open ? ' is-open' : ''}`} inert={!open}>
            <div className="gunsmith-details-inner">
              {open && (step.build
                ? <GunsmithQuestPlan build={step.build} part={step.part} compact />
                : <p className="dim">{uiText('Подробных требований к сборке в данных пока нет.')}</p>)}
            </div>
          </div>
        </div>
      })}
    </div>
  </section>
}
