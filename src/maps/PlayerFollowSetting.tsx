import { useRemoteFeatures } from '../announcement/features'
import { uiText } from '../i18n/renderText'
import { setPlayerFollowOn, usePlayerFollowOn } from './playerFollow'

/**
 * «Настройки карты»: whether the map comes to the player's dot on a new screenshot (maps/playerFollow.ts). The PC app only, and
 * not while the owner keeps the position off for everybody (src/announcement/features.ts): there is no dot then.
 */
export function PlayerFollowSetting() {
  const on = usePlayerFollowOn()
  const features = useRemoteFeatures()
  if (!window.tarkovDesktop?.experimental || !features.minimap) return null
  const title = uiText('Приближать карту к точке')
  return <div className="skill-timer-settings" role="group" aria-label={title}>
    <div className="map-panels-menu-title">{uiText('Местоположение')}</div>
    <div className="skill-timer-row">
      <span>{title}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={title} className={`toggle ${on ? 'on' : ''}`} onClick={() => setPlayerFollowOn(!on)}><span /></button>
    </div>
  </div>
}
