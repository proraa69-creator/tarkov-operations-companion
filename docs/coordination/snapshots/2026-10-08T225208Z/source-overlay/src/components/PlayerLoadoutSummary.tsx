import { uiText } from '../i18n/renderText'
import type { PlayerProfileSnapshot } from '../domain/types'

export function PlayerLoadoutSummary({ snapshot, compact = false }: { snapshot?: PlayerProfileSnapshot; compact?: boolean }) {
  if (!snapshot) return <div className="player-loadout-empty"><span>{uiText("Профиль игрока ещё не обновлён")}</span></div>
  return <div className={`player-loadout${compact ? ' is-compact' : ''}`}>
    <div className="player-loadout-identity">
      <span className="tag brass">{uiText(snapshot.faction.toUpperCase())}</span>
      <div className="player-identity-copy">
        <h3>{uiText(snapshot.nickname)}</h3>
        <p>{uiText("Уровень ")}{uiText(snapshot.level)}{uiText(snapshot.accountType ? ` · ${snapshot.accountType}` : '')}</p>
      </div>
      {uiText(snapshot.totalInGameTime ? <small>{uiText(Math.floor(snapshot.totalInGameTime / 3600))}{uiText(" ч. в игре")}</small> : null)}
    </div>
  </div>
}
