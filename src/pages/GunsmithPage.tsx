import { useLayoutEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Lock, Trophy, Wrench, X } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { questAvailabilityOf } from '../quests/questReadModel'
import { ManualMarkActions, ManualTag } from '../quests/ManualMarks'
import type { ModeProgress, RaidMode } from '../domain/types'
import { gunsmithSteps, gunsmithSummary, stepStatus, type GunsmithStep } from '../gunsmith/gunsmith'
import { GunsmithQuestPlan } from '../gunsmith/GunsmithQuestPlan'
import { useFitBelow } from '../app/useFitBelow'
import { useMobileLayout } from '../platform'
import { usePhoneGunsmithView } from '../gunsmith/phoneGunsmithView'
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
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const steps = useMemo(() => gunsmithSteps(data.quests, (id) => availability.get(id)?.status), [availability, data.quests])
  const summary = gunsmithSummary(steps)
  // `?quest=<task id>` (links from the Overview and the task cards); `?part=N` (place in the chain) still works.
  const requestedQuest = params.get('quest')
  const requestedPart = Number(params.get('part'))
  const fallback = summary.active[0] ?? summary.next ?? steps[0]
  const selected = steps.find((step) => step.quest.id === requestedQuest) ?? steps.find((step) => step.part === requestedPart) ?? fallback
  const select = (step: GunsmithStep) => setParams((current) => { const next = new URLSearchParams(current); next.delete('part'); next.set('quest', step.quest.id); return next }, { replace: true })
  // The phone (owner, 16.11.2026): a part opens only when it is pressed (or asked for by a link), as a window with «Назад»
  // or, if so chosen in «Настройки», unfolded under its row with a cross (src/gunsmith/phoneGunsmithView.ts).
  const phone = useMobileLayout()
  const phoneView = usePhoneGunsmithView()
  const navigate = useNavigate()
  const location = useLocation()
  const opened = phone ? steps.find((step) => step.quest.id === requestedQuest) ?? steps.find((step) => step.part === requestedPart) : undefined
  const listScroll = useRef<number | null>(null)
  const closePart = () => {
    if ((location.state as { gunsmithList?: boolean } | null)?.gunsmithList) navigate(-1)
    else setParams((current) => { const next = new URLSearchParams(current); next.delete('part'); next.delete('quest'); return next }, { replace: true })
  }
  const openPart = (step: GunsmithStep) => {
    if (opened?.part === step.part) { closePart(); return }
    if (phoneView === 'window') listScroll.current = scrollerOf(layout.current)?.scrollTop ?? 0
    // The window is a step of its own in the history: «Назад» and the phone's back button return to the list.
    const pushed = phoneView === 'window' || !opened
    setParams((current) => { const next = new URLSearchParams(current); next.delete('part'); next.set('quest', step.quest.id); return next },
      pushed ? { state: { gunsmithList: true } } : { replace: true, state: location.state })
  }
  const windowed = phone && phoneView === 'window' && opened
  // Back from the window: the list where it was left; into the window: its top.
  useLayoutEffect(() => {
    if (!phone || phoneView !== 'window') return
    const scroller = scrollerOf(layout.current ?? document.querySelector('.gunsmith-page'))
    if (!scroller) return
    if (windowed) scroller.scrollTop = 0
    else if (listScroll.current !== null) { scroller.scrollTop = listScroll.current; listScroll.current = null }
  }, [phone, phoneView, windowed])
  // Both columns end at the bottom of the window: the parts and the part's card scroll inside, the page stays put.
  const layout = useRef<HTMLDivElement>(null)
  useFitBelow(layout, steps.length > 0)

  if (windowed) return <div className="page gunsmith-page is-part-window">
    <div className="gunsmith-window-bar">
      <button type="button" className="button ghost" onClick={closePart}><ArrowLeft size={15} />{uiText(' Назад')}</button>
    </div>
    <PartDetail key={opened.part} step={opened} playerLevel={progress.playerLevel} mode={state.raidMode} progress={progress} />
  </div>

  return <div className="page gunsmith-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Механик · ')}{uiText(state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase())}</div>
        <h1 className="page-title">{uiText('Оружейник')}</h1>
        {/* No subtitle (owner, 01.11.2026: crossed out, «удалить везде упоминание Тарков дев»). */}
      </div>
      <div className="gunsmith-page-actions">
        <Link to="/" className="button ghost"><ArrowLeft size={15} />{uiText(' Обзор')}</Link>
      </div>
    </header>

    {!steps.length
      ? <section className="panel"><div className="panel-body"><p className="muted">{uiText('Задания «Оружейник» не найдены в базе заданий этого режима.')}</p></div></section>
      : <div ref={layout} className="gunsmith-layout">
        <section className="panel gunsmith-list">
          <div className="panel-header"><div className="panel-title"><Wrench size={15} aria-hidden="true" /> {uiText('Части')}</div></div>
          {summary.unknown > 0 && <p className="gunsmith-parts-hint">{uiText('Отметьте галочкой части, которые вы сделали раньше: игра хранит логи несколько недель, и более старые части приложение не видит.')}</p>}
          <ol className="gunsmith-parts">
            {steps.map((step) => {
              const unfolded = phone && phoneView === 'expand' && opened?.part === step.part
              return <li key={step.part} className={unfolded ? 'is-unfolded' : undefined}>
                <PartRow step={step} selected={phone ? opened?.part === step.part : step.part === selected?.part} playerLevel={progress.playerLevel}
                  onSelect={() => (phone ? openPart(step) : select(step))} closable={unfolded} />
                <PartCheck step={step} mode={state.raidMode} progress={progress} />
                {unfolded && <div className="gunsmith-unfolded"><PartDetail step={step} playerLevel={progress.playerLevel} mode={state.raidMode} progress={progress} /></div>}
              </li>
            })}
          </ol>
        </section>
        {!phone && selected && <PartDetail key={selected.part} step={selected} playerLevel={progress.playerLevel} mode={state.raidMode} progress={progress} />}
      </div>}
  </div>
}

/** What scrolls the page: the nearest scrolling box around it, else the document. */
function scrollerOf(element: Element | null): HTMLElement | null {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return node
  }
  return document.scrollingElement as HTMLElement | null
}

function PartRow({ step, selected, playerLevel, onSelect, closable }: { step: GunsmithStep; selected: boolean; playerLevel: number; onSelect: () => void; closable?: boolean }) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const weapon = step.build ? data.items.find((item) => item.id === step.build!.weaponId) : undefined
  return <button type="button" className={`gunsmith-part-row is-${step.status}${selected ? ' is-selected' : ''}${closable ? ' has-close' : ''}`} aria-current={selected || undefined}
    aria-expanded={closable || undefined} onClick={onSelect}>
    <span className="gunsmith-part-index">{step.status === 'completed' ? <Check size={12} aria-hidden="true" /> : step.part}</span>
    {weapon?.presetImageUrl || weapon?.iconUrl ? <img className="gunsmith-part-thumb" src={weapon.presetImageUrl ?? weapon.iconUrl} alt="" loading="lazy" /> : <span className="gunsmith-part-thumb" />}
    <span className="gunsmith-part-copy">
      <strong>{uiText(step.quest.name)}</strong>
      <small>{uiText(weapon?.shortName ?? '')}{weapon ? ' · ' : ''}{uiText(`ур. ${step.quest.level}`)}</small>
    </span>
    {step.status !== 'unknown' && <span className="gunsmith-part-status">{step.status === 'locked' && <Lock size={10} aria-hidden="true" />}{stepStatus(step, playerLevel, locale)}</span>}
    {/* The unfolded part's cross (phone, «Раскладывать»): the row closes it. */}
    {closable && <span className="gunsmith-part-close" aria-label={uiText('Закрыть')}><X size={18} aria-hidden="true" /></span>}
  </button>
}

/**
 * The part's checkmark (a player's ticket, 02.11.2026: «Можно сделать так что бы ты сам ставил галочки что ты сделал из
 * оружейника а что нет»). The parts come from the game logs only, which the game keeps a few weeks, so the parts done
 * before them show nothing. A tick is the player's «Ручная отметка» «Выполнено» of this mode (src/quests/ManualMarks.tsx):
 * synced through the server and weighed against the logs. A part the game reports done stays ticked.
 */
function PartCheck({ step, mode, progress }: { step: GunsmithStep; mode: RaidMode; progress: ModeProgress }) {
  const { setManualQuestMark } = useAppState()
  const { locale } = useLocale()
  const en = locale === 'en'
  const done = step.status === 'completed'
  const marked = done && progress.questInputs?.manual[step.quest.id]?.status === 'completed'
  const title = !done ? (en ? 'Mark as done' : 'Отметить выполненной') : marked ? (en ? 'Marked by hand: press to remove the mark' : 'Отмечено вручную: нажмите, чтобы снять отметку') : (en ? 'Done in the game' : 'Выполнено в игре')
  return <button type="button" role="checkbox" aria-checked={done} aria-label={`${en ? 'Done' : 'Выполнено'}: ${uiText(step.quest.name)}`} title={title}
    className={`gunsmith-part-check${marked ? ' is-manual' : ''}`} disabled={done && !marked}
    onClick={() => setManualQuestMark(mode, step.quest.id, done ? null : 'completed')}>
    {done && <Check size={13} aria-hidden="true" />}
  </button>
}

function PartDetail({ step, playerLevel, mode, progress }: { step: GunsmithStep; playerLevel: number; mode: RaidMode; progress: ModeProgress }) {
  const { quest } = step
  const { locale } = useLocale()
  const description = quest.objectiveDetails?.find((objective) => objective.build)?.description
  return <section className="panel detail-panel gunsmith-detail">
    <div className="detail-hero">
      <div className="eyebrow">{uiText(quest.trader)} · {uiText(`уровень ${quest.level}`)}</div>
      <h2>{uiText(quest.name)}</h2>
      <div className="quest-full-tags">{step.status !== 'unknown' && <span className={`tag ${step.status === 'completed' ? 'green' : step.status === 'active' ? 'brass' : ''}`}>{stepStatus(step, playerLevel, locale)}</span>}{quest.kappa && <span className="tag brass">{uiText('капа')}</span>}<ManualTag progress={progress} questId={quest.id} locale={locale} /></div>
      {/* «В текущие», «Выполнено», «Снять отметку»: a part taken or handed in before the oldest log. */}
      <ManualMarkActions questId={quest.id} mode={mode} progress={progress} locale={locale} />
    </div>
    {description && <div className="detail-section"><h4>{uiText('Задача')}</h4><p>{uiText(description)}</p></div>}
    {step.builds.length
      ? step.builds.map((entry, index) => <GunsmithQuestPlan key={`${entry.weaponId}-${index}`} build={entry} questId={step.quest.id}
        weapon={step.builds.length > 1 ? { index, total: step.builds.length } : undefined} />)
      : <div className="detail-section"><p className="dim">{uiText('Подробных требований к сборке в данных пока нет.')}</p></div>}
    <div className="detail-section">
      <h4>{uiText('Награды')}</h4>
      {quest.rewards.length
        ? <div className="quest-full-rewards">{quest.rewards.map((reward) => <span key={reward}><Trophy size={14} />{uiText(reward)}</span>)}</div>
        : <p className="dim">{uiText('Награды не указаны.')}</p>}
    </div>
  </section>
}
