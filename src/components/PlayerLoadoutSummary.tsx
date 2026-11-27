import { uiText } from '../i18n/renderText'
import type { LevelAnchor, PlayerProfileSnapshot } from '../domain/types'
import { ManualLevelField } from './ManualLevelField'

/**
 * The level alone: no «с экрана игры, 31.10, 22:27» under it (owner, 01.11.2026, crossed out on the profile).
 * Nothing read for the mode (owner, 27.11.2026): the level its completed quests prove, «Уровень не ниже N», and
 * «Указать уровень» (`onLevelEntered`) while no reading has the level — under the player's own entry too, to correct it.
 */
export function PlayerLoadoutSummary({ snapshot, level, anchor, compact = false, onLevelEntered }: { snapshot?: PlayerProfileSnapshot; level?: number; anchor?: LevelAnchor; compact?: boolean; onLevelEntered?: (level: number) => void }) {
  const shownLevel = level ?? snapshot?.level
  const entry = onLevelEntered && (!anchor || anchor.source === 'manual') ? <ManualLevelField onSave={onLevelEntered} /> : null
  if (!snapshot) {
    // Without an anchor a level above 1 is the quests' estimate (src/domain/progress.ts applyLevelEstimate).
    const estimate = !anchor && shownLevel !== undefined && shownLevel > 1
    if (!estimate && (!anchor || !shownLevel)) return <div className="player-loadout-empty"><span>{uiText('Уровень появится, когда вы запустите игру: Raid OS прочитает его с экрана «Выбор профиля и режима».')}</span>{entry}</div>
    return <div className={`player-loadout${compact ? ' is-compact' : ''}`}>
      <div className="player-loadout-identity">
        <div className="player-identity-copy">
          <h3>{estimate ? uiText(`Уровень не ниже ${shownLevel}`) : <>{uiText('Уровень ')}{shownLevel}</>}</h3>
          {entry}
        </div>
      </div>
    </div>
  }
  return <div className={`player-loadout${compact ? ' is-compact' : ''}`}>
    <div className="player-loadout-identity">
      <span className="tag brass">{uiText(snapshot.faction.toUpperCase())}</span>
      <div className="player-identity-copy">
        <h3>{uiText(snapshot.nickname)}</h3>
        <p>{uiText('Уровень ')}{uiText(shownLevel)}{uiText(snapshot.accountType ? ` · ${snapshot.accountType}` : '')}</p>
        {entry}
      </div>
      {uiText(snapshot.totalInGameTime ? <small>{uiText(Math.floor(snapshot.totalInGameTime / 3600))}{uiText(' ч. в игре')}</small> : null)}
    </div>
  </div>
}
