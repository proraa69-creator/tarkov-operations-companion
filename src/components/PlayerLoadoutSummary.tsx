import { uiText } from '../i18n/renderText'
import type { LevelAnchor, PlayerProfileSnapshot } from '../domain/types'

/** Where the level was read and when: «с экрана игры, 13.10 21:04» / «tarkov.dev, 13.10 20:58». */
function levelSource(anchor: LevelAnchor | undefined, level: number) {
  if (!anchor) return ''
  const when = new Date(anchor.observedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const from = anchor.source === 'screen' ? uiText('с экрана игры') : 'tarkov.dev'
  return `${from}, ${when}${level > anchor.level ? ` · ${uiText('+ опыт сданных заданий')}` : ''}`
}

export function PlayerLoadoutSummary({ snapshot, level, anchor, compact = false }: { snapshot?: PlayerProfileSnapshot; level?: number; anchor?: LevelAnchor; compact?: boolean }) {
  const shownLevel = level ?? snapshot?.level
  if (!snapshot) {
    if (!anchor || !shownLevel) return <div className="player-loadout-empty"><span>{uiText('Уровень появится, когда вы запустите игру: Raid OS прочитает его с экрана «Выбор профиля и режима».')}</span></div>
    return <div className={`player-loadout${compact ? ' is-compact' : ''}`}>
      <div className="player-loadout-identity">
        <div className="player-identity-copy">
          <h3>{uiText('Уровень ')}{shownLevel}</h3>
          <p>{levelSource(anchor, shownLevel)}</p>
        </div>
      </div>
    </div>
  }
  return <div className={`player-loadout${compact ? ' is-compact' : ''}`}>
    <div className="player-loadout-identity">
      <span className="tag brass">{uiText(snapshot.faction.toUpperCase())}</span>
      <div className="player-identity-copy">
        <h3>{uiText(snapshot.nickname)}</h3>
        <p>{uiText('Уровень ')}{uiText(shownLevel)}{uiText(snapshot.accountType ? ` · ${snapshot.accountType}` : '')}{anchor ? ` · ${levelSource(anchor, shownLevel ?? 0)}` : ''}</p>
      </div>
      {uiText(snapshot.totalInGameTime ? <small>{uiText(Math.floor(snapshot.totalInGameTime / 3600))}{uiText(' ч. в игре')}</small> : null)}
    </div>
  </div>
}
