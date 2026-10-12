import { useState } from 'react'
import { useLocale } from '../i18n/LocaleProvider'
import { useServerStatus } from '../sync/serverSync'
import { restartGuide } from './guideProgress'

/** Settings → «Интерфейс»: the first-run tips once more (src/onboarding/FirstRunGuide.tsx), for the signed-in account. */
export function GuideReplaySetting() {
  const { locale } = useLocale()
  const en = locale === 'en'
  const status = useServerStatus()
  const [done, setDone] = useState(false)
  const email = status?.signedIn ? status.email : undefined
  if (!email) return null
  return <div className="setting-row">
    <span>
      <strong>{en ? 'Tips for new players' : 'Подсказки для новых игроков'}</strong>
      <small>{done
        ? (en ? 'Done: each section shows its tip again on your next visit.' : 'Готово: каждый раздел снова покажет свою подсказку, когда вы в него зайдёте.')
        : (en ? 'Story quests, mini map, map checkmarks, Kappa items.' : 'Сюжетные задания, мини-карта, галочки на карте, предметы для Каппы.')}</small>
    </span>
    <button type="button" className="button small" disabled={done} onClick={() => { restartGuide(email); setDone(true) }}>{en ? 'Show again' : 'Показать снова'}</button>
  </div>
}
