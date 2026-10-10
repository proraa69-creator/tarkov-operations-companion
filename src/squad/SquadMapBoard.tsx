import { Map as MapIcon } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { SquadMapEntry } from './squadOverview'
import { MemberAvatar, MemberChips } from './squadUi'

interface BoardMember { memberId: string; label: string; index: number; hidden?: boolean }

/**
 * «Квесты по картам»: one card per map with every member's number of active quests there (a bar each) and the quests
 * two or more members share, with who has them — so the squad sees at a glance where to go together.
 */
export function SquadMapBoard({ maps, members, names, questName, mapName }: {
  maps: SquadMapEntry[]
  members: BoardMember[]
  names: Map<string, { label: string; index: number }>
  questName: (id: string) => string
  mapName: (id: string) => string
}) {
  const counts = maps.map((map) => new Map(members.map((member) => [member.memberId, map.quests.filter((quest) => quest.memberIds.includes(member.memberId)).length])))
  const most = Math.max(1, ...counts.flatMap((row) => [...row.values()]))
  return (
    <div className="squad-board">
      {maps.map((map, mapIndex) => {
        const shared = map.quests.filter((quest) => quest.memberIds.length >= 2)
        return (
          <article key={map.mapId} className={`squad-board-map${shared.length ? ' has-shared' : ''}`}>
            <header>
              <strong><MapIcon size={14} />{uiText(mapName(map.mapId))}</strong>
              <span className="squad-board-totals">
                {uiText('Квестов')}: {map.quests.length}
                {shared.length > 0 && <span className="squad-board-shared">{uiText('общих')}: {shared.length}</span>}
              </span>
            </header>
            <ul className="squad-board-members">
              {members.map((member) => {
                const count = counts[mapIndex].get(member.memberId) ?? 0
                return (
                  <li key={member.memberId} className={count ? '' : 'is-empty'}>
                    <MemberAvatar name={member.label} index={member.index} />
                    <span className="squad-board-name">{member.label}</span>
                    <span className={`squad-board-bar hue-${member.index % 5}`} aria-hidden><i style={{ width: `${(count / most) * 100}%` }} /></span>
                    <b className="mono">{member.hidden ? '—' : count}</b>
                  </li>
                )
              })}
            </ul>
            {shared.length > 0 && (
              <div className="squad-board-common">
                <span className="stat-label">{uiText('Общие квесты')}</span>
                {shared.map((quest) => (
                  <div key={quest.questId} className="squad-board-quest">
                    <span>{uiText(questName(quest.questId))}</span>
                    {quest.memberIds.length === members.length && members.length > 2
                      ? <span className="squad-chip hue-0">{uiText('у всех')}</span>
                      : <MemberChips ids={quest.memberIds} names={names} />}
                  </div>
                ))}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
