import { useState } from 'react'
import { uiText } from '../i18n/renderText'
import { SettingHelp } from './SettingHelp'
import { playUiSound, setUiSoundVolume, uiSoundVolume } from '../shared/uiSound'

/**
 * Settings → «Интерфейс»: the volume of the clicks (owner, 03.11.2026: «в настройках добавь кнопку громкости щелканий при
 * нажатии… сделай ползунок громкости, если минимальный, это выкл щелчки»). 100 % is the level they had; the leftmost end
 * turns them off (src/shared/uiSound.ts). Letting go of the slider plays one click at the new level.
 */
export function ClickVolumeSetting() {
  const [percent, setPercent] = useState(() => Math.round(uiSoundVolume() * 100))
  const change = (next: number) => {
    setPercent(next)
    setUiSoundVolume(next / 100)
  }
  return <div className="setting-row">
    <span>
      <strong>{uiText('Громкость щелчков')}<SettingHelp id="clickVolume" /></strong>
      <small>{percent ? `${percent}%` : uiText('Щелчки выключены')}</small>
    </span>
    <input
      type="range"
      className="click-volume"
      min={0}
      max={100}
      step={5}
      value={percent}
      aria-label={uiText('Громкость щелчков')}
      onChange={(event) => change(Number(event.target.value))}
      onPointerUp={() => playUiSound('click')}
      onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') playUiSound('click') }}
    />
  </div>
}
