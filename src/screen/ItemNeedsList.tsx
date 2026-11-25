import { Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { gunsmithHref } from '../gunsmith/gunsmith'
import type { Item } from '../domain/types'
import { needParts, type ItemBarterUse, type ItemQuestUse } from './itemUses'

/** Hover card: so many lines of each list, then «ещё N» (the full card has them all). */
const SHORT_QUESTS = 5
const SHORT_BARTERS = 3

/**
 * «Нужен для квестов» and «Нужен для бартеров» of a tier list's item (screen/itemUses.ts): in its hover card the first few
 * (`short`), in its full card all of them with links to the quests. Nothing when the item is needed for none.
 */
export function ItemNeedsList({ quests, barters, items, en, short = false }: {
  quests: readonly ItemQuestUse[]
  barters: readonly ItemBarterUse[]
  items: ReadonlyMap<string, Item>
  en: boolean
  short?: boolean
}) {
  if (!quests.length && !barters.length) return null
  const say = (ru: string, english: string) => en ? english : ru
  const questRows = short ? quests.slice(0, SHORT_QUESTS) : quests
  const barterRows = short ? barters.slice(0, SHORT_BARTERS) : barters
  const more = (left: number) => left > 0 && <li className="item-needs-more">{say(`ещё ${left}`, `${left} more`)}</li>
  const href = (use: ItemQuestUse) => use.gunsmith ? gunsmithHref({ id: use.questId }) : `/quests?filter=all&selected=${encodeURIComponent(use.questId)}`
  const reward = (use: ItemBarterUse) => {
    const item = items.get(use.rewardId)
    const name = uiText((short ? item?.shortName : item?.name) ?? item?.name ?? use.rewardId)
    return `${name}${use.rewardCount > 1 ? ` ×${use.rewardCount}` : ''}`
  }
  // The hover card's small titles; the full card's are its sections' own.
  const Title = short ? 'h5' : 'h4'
  return <div className={`item-needs${short ? ' is-short' : ''}`}>
    {quests.length > 0 && <>
      <Title>{say('Нужен для квестов', 'Needed for quests')}</Title>
      <ul>
        {questRows.map((use) => {
          // the word and its count as two texts: the other languages translate the word (itemUses.ts needParts)
          const [word, rest] = needParts(use, en)
          return <li key={use.questId} className={use.done ? 'is-done' : undefined}>
            <span className="item-needs-name">{use.done && <Check size={12} aria-hidden="true" />}{short ? uiText(use.name) : <Link to={href(use)}>{uiText(use.name)}</Link>}</span>
            <span className="item-needs-what">{word}{rest}</span>
          </li>
        })}
        {more(quests.length - questRows.length)}
      </ul>
    </>}
    {barters.length > 0 && <>
      <Title>{say('Нужен для бартеров', 'Needed for barters')}</Title>
      <ul>
        {barterRows.map((use) => <li key={use.id}>
          <span className="item-needs-name">{uiText(use.trader)} {use.level} · {reward(use)}</span>
          <span className="item-needs-what">×{use.count}</span>
        </li>)}
        {more(barters.length - barterRows.length)}
      </ul>
    </>}
  </div>
}
