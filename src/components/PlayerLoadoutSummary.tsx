import { uiText } from '../i18n/renderText'
import type { LevelAnchor, PlayerProfileSnapshot } from '../domain/types'

/** The level alone: no «с экрана игры, 31.10, 22:27» under it (owner, 01.11.2026, crossed out on the profile). */
export function PlayerLoadoutSummary({ snapshot, level, anchor, compact = false }: { snapshot?: PlayerProfileSnapshot; level?: number; anchor?: LevelAnchor; compact?: boolean }) {
  const shownLevel = level ?? snapshot?.level
  if (!snapshot) {
    if (!anchor || !shownLevel) return <div className="player-loadout-empty"><span>{uiText('Уровень появится, когда вы запустите игру: Raid OS прочитает его с экрана «Выбор профиля и режима».')}</span></div>
    return <div className={`player-loadout${compact ? ' is-compact' : ''}`}>
      <div className="player-loadout-identity">
        <div className="player-identity-copy">
          <h3>{uiText('Уровень ')}{shownLevel}</h3>
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
      </div>
      {uiText(snapshot.totalInGameTime ? <small>{uiText(Math.floor(snapshot.totalInGameTime / 3600))}{uiText(' ч. в игре')}</small> : null)}
    </div>
  </div>
}
