import { Briefcase, DoorOpen, Hammer, RotateCcw, Split, TriangleAlert, Trophy } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { ENDINGS, ENDINGS_NOTE, ENDINGS_START, KERMAN_ROAD, STORY_DECISIONS, endingName, type EndingStep, type Phrase } from './storyEndings'
import './storyEndings.css'

const STEP_ICONS = { craft: Hammer, achievement: Trophy, warning: TriangleAlert }

/** A step of a road: a craft, an achievement or a warning gets its icon; a step for one mode / one earlier choice its tag. */
function Step({ step, mode, say }: { step: EndingStep; mode: RaidMode; say: (phrase: Phrase) => string }) {
  const Icon = step.kind ? STEP_ICONS[step.kind] : null
  // PvP steps also hold for the season; the other mode's step stays readable but dimmed
  const otherMode = (step.when?.en === 'PvP' && mode === 'pve') || (step.when?.en === 'PvE' && mode !== 'pve')
  return <li className={`ending-step${step.kind ? ` is-${step.kind}` : ''}${otherMode ? ' is-other-mode' : ''}`}>
    {Icon && <Icon size={14} aria-hidden="true" />}
    <span>{step.when && <span className="ending-when">{say(step.when)}</span>}{say(step.text)}</span>
  </li>
}

/**
 * «Концовки» (Quests page, filter=endings): the case from the plane, the choice about Mr. Kerman and the four
 * endings with every step, the way out through the Terminal and what to do when the attempt fails.
 */
export function StoryEndingsView({ mode }: { mode: RaidMode }) {
  const { locale } = useLocale()
  const say = (phrase: Phrase) => phrase[locale === 'en' ? 'en' : 'ru']
  const quoted = (phrase: Phrase) => (locale === 'en' ? `“${phrase.en}”` : `«${phrase.ru}»`)
  const kerman = STORY_DECISIONS.find((decision) => decision.id === 'kerman-offer')!
  const evidence = STORY_DECISIONS.find((decision) => decision.id === 'kerman-evidence')!
  return <div className="story-endings">
    <section className="panel ending-start">
      <div className="panel-header"><div className="panel-title"><Briefcase size={15} aria-hidden="true" /> {say(ENDINGS_START.take)}</div></div>
      <div className="panel-body">
        <div className="ending-fork">
          <div className="ending-branch">
            <h3>{say(ENDINGS_START.give.choice)}</h3>
            <ol className="ending-steps">{ENDINGS_START.give.steps.map((text) => <Step key={text.ru} step={{ text }} mode={mode} say={say} />)}</ol>
          </div>
          <div className="ending-branch">
            <h3>{say(ENDINGS_START.keep.choice)}</h3>
            <p className="dim">{say({ ru: 'Кейс сразу ваш — переходите к открытию.', en: 'The case is yours right away: go on to opening it.' })}</p>
          </div>
        </div>
        <ol className="ending-steps ending-join">
          <Step step={{ text: ENDINGS_START.open }} mode={mode} say={say} />
          <Step step={{ text: ENDINGS_START.openCraft, kind: 'craft' }} mode={mode} say={say} />
          <li className="ending-step is-milestone"><span>{say(ENDINGS_START.opened)}</span></li>
        </ol>
      </div>
    </section>

    <section className="panel ending-choice">
      <div className="panel-header"><div className="panel-title"><Split size={15} aria-hidden="true" /> {say(kerman.title)}</div></div>
      <div className="panel-body ending-fork">
        {kerman.options.map((option) => <div className="ending-branch" key={option.choice.ru}>
          <h3>{say(option.choice)}</h3>
          <p>{say(option.outcome)}</p>
          {option.endings.length > 1 && <>
            <ol className="ending-steps">{KERMAN_ROAD.map((step) => <Step key={step.text.ru} step={step} mode={mode} say={say} />)}</ol>
            <p className="ending-subchoice"><Split size={13} aria-hidden="true" /> {say(evidence.title)}</p>
            <ul className="ending-subchoices">{evidence.options.map((entry) => <li key={entry.choice.ru} className={`is-${entry.endings[0]}`}>
              {say(entry.choice)} → <strong>{quoted(endingName(entry.endings[0]))}</strong>
            </li>)}</ul>
          </>}
        </div>)}
      </div>
    </section>

    <div className="ending-grid">
      {ENDINGS.map((ending) => <section key={ending.id} className={`panel ending-card is-${ending.id}`} aria-labelledby={`ending-${ending.id}`}>
        <header className="ending-card-head">
          <span className="ending-card-kicker">{say({ ru: 'Концовка', en: 'Ending' })}</span>
          <h3 id={`ending-${ending.id}`}>{quoted(ending.name)}</h3>
          <p>{say(ending.route)}</p>
        </header>
        <ol className="ending-steps">{ending.steps.map((step) => <Step key={step.text.ru} step={step} mode={mode} say={say} />)}</ol>
        <div className="ending-exit">
          <p><DoorOpen size={14} aria-hidden="true" /> <span>{say(ending.escape)}</span></p>
          <p className="dim"><RotateCcw size={14} aria-hidden="true" /> <span>{say(ending.retry)}</span></p>
        </div>
      </section>)}
    </div>
    <p className="ending-note dim">{say(ENDINGS_NOTE)}</p>
  </div>
}
