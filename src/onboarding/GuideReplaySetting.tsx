import { useState } from 'react'
import { useLocale } from '../i18n/LocaleProvider'
import { replayTours } from './tours'

/** Settings → «Интерфейс»: each tab's tips once more (src/onboarding/tours.ts), on its next visit. */
export function GuideReplaySetting() {
  const { locale } = useLocale()
  const en = locale === 'en'
  const [done, setDone] = useState(false)
  return <div className="setting-row">
    <span>
      <strong>{en ? 'Tips on the tabs' : 'Подсказки по вкладкам'}</strong>
      <small>{done
        ? (en ? 'Done: each tab shows its main things again when you open it.' : 'Готово: каждая вкладка снова коротко покажет главное, когда вы её откроете.')
        : (en ? 'Overview, quests, maps, hideout and the other tabs: the main things, briefly.' : 'Обзор, квесты, карты, убежище и другие вкладки: коротко о главном.')}</small>
    </span>
    <button type="button" className="button small" disabled={done} onClick={() => { replayTours(); setDone(true) }}>{en ? 'Show again' : 'Показать снова'}</button>
  </div>
}
