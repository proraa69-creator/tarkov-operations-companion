import { Link } from 'react-router-dom'
import { Split } from 'lucide-react'
import type { Quest } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { featureEnabled } from '../app/archivedFeatures'
import { decisionAtStage, decisionsFor, endingName, type DecisionOption, type Phrase, type StoryDecision } from './storyEndings'
import './storyEndings.css'

const endingsLink = '/quests?filter=endings'

function useSay() {
  const { locale } = useLocale()
  return (phrase: Phrase) => phrase[locale === 'en' ? 'en' : 'ru']
}

function Endings({ option }: { option: DecisionOption }) {
  const { locale } = useLocale()
  if (option.endings.length >= 4) return null
  return <span className="decision-endings">{option.endings.map((id) => <span key={id} className={`tag ending-tag is-${id}`}>
    {locale === 'en' ? `“${endingName(id).en}”` : `«${endingName(id).ru}»`}
  </span>)}</span>
}

/**
 * The deciding choices of a story chapter (or of a BTR Driver's task) and where each one leads, under the chapter's
 * objectives (owner, 12.10.2026: «в квесте… должно сообщаться что такое то решение приведет туда то»).
 */
export function StoryDecisionNotes({ quest }: { quest: Pick<Quest, 'id' | 'name' | 'normalizedName' | 'kind' | 'trader'> }) {
  const say = useSay()
  if (!featureEnabled('storyEndings')) return null
  const decisions = decisionsFor(quest)
  if (!decisions.length) return null
  return <section className="detail-section story-decisions">
    {decisions.map((decision: StoryDecision) => <div key={decision.id} className="story-decision">
      <h4><Split size={14} aria-hidden="true" /> {say(decision.title)}</h4>
      <ul>{decision.options.map((option) => <li key={option.choice.ru}>
        <strong>{say(option.choice)}</strong> <span>{say(option.outcome)}</span> <Endings option={option} />
      </li>)}</ul>
    </div>)}
    <Link className="button ghost small" to={endingsLink}>{say({ ru: 'Все концовки', en: 'All endings' })}</Link>
  </section>
}

/** Under a chapter objective that is a deciding choice: where it leads, right there. */
export function StageDecisionHint({ text }: { text: string }) {
  const say = useSay()
  if (!featureEnabled('storyEndings')) return null
  const found = decisionAtStage(text)
  if (!found) return null
  const { decision, option } = found
  return <p className="story-decision-hint">
    <Split size={13} aria-hidden="true" />
    <span>{option
      ? <>{say({ ru: 'Решающий выбор: ', en: 'A deciding choice: ' })}{say(option.outcome)} <Endings option={option} /></>
      : <>{say(decision.title)}: {decision.options.map((entry) => `${say(entry.choice)} — ${say(entry.outcome)}`).join(' ')}</>}</span>
  </p>
}
