import { Crosshair } from 'lucide-react'
import type { Item, Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { QuestBuild } from './QuestConditionsCard'
import { usePictures } from './usePictures'
import { gearObjectives, gearObjectivesOnMap } from './questConditions'
import '../styles/questConditions.css'

/**
 * The heading of the section «С условиями на снаряжение» at the bottom of «Текущие задания» (Overview) and «Квесты на
 * карте» (Maps): the quests with a weapon, parts or gear condition, apart from the ordinary ones (owner, 15.10.2026:
 * «придумай какую то отдельную колонку для них. что бы не путаться в квестах»). Only a grouping: the counts stay.
 */
export function GearSectionHeading({ count }: { count: number }) {
  return <div className="gear-section-head" role="heading" aria-level={4}>
    <span className="gear-section-icon" aria-hidden="true"><Crosshair size={13} /></span>
    <span className="gear-section-title">{uiText('С условиями на снаряжение')}</span>
    <span className="gear-section-count">{count}</span>
  </div>
}

/**
 * «Снаряжение для рейда» in the map's quest sheet: the weapons with pictures, the parts, the gear to wear and not to
 * wear, and the conditions of the quest's objectives on this map (all of them when none is on this map).
 */
export function RaidGearBlock({ quest, mapId, mapName, items }: { quest: Pick<Quest, 'objectiveDetails'>; mapId: string; mapName: (id: string) => string; items: Item[] }) {
  const pictures = usePictures(items)
  const here = gearObjectivesOnMap(quest, mapId)
  const objectives = here.length ? here : gearObjectives(quest)
  if (!objectives.length) return null
  return <section className="qc-raid-gear" aria-label={uiText('Снаряжение для рейда')}>
    <h4><Crosshair size={12} aria-hidden="true" /> {uiText('Снаряжение для рейда')}</h4>
    {/* The sheet lists the objectives above: one objective's text is not repeated. */}
    <QuestBuild objectives={objectives} mapId={mapId} mapName={mapName} pictures={pictures} texts={objectives.length > 1} />
  </section>
}
