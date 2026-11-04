import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import './manualMarks.css'

/**
 * «Не все квесты?» beside «Найти квесты по экрану» (owner, 04.11.2026: «люди не поймут что нужно сделать если у них не будет
 * каких либо квестов … кнопку … она будет обяснять людям что сделать если нехватает квеста или наоборот … описание
 * короткое»): after the first sync the Tasks table is read only when the player asks, so the page says how to ask. It names
 * the real button by its own label, so it cannot drift from it. Owner, 04.11.2026: «Не должно быть, чтобы человек сам его должен
 * был убирать … он делает сканирование также, и этот квест уходит»: one action for both cases (src/import/tableSweep.ts).
 */
export function questsHelpText(locale: 'ru' | 'en') {
  const scan = uiText('Найти квесты по экрану')
  return locale === 'en'
    ? {
      button: 'Missing quests?', close: 'Close',
      missingTitle: 'A quest is missing',
      missing: `Press «${scan}», open «Character» → «Tasks» in the game and slowly scroll the whole list from top to bottom: the quest adds itself.`,
      extraTitle: 'An extra quest',
      extra: 'Do the same: what the game\'s list does not have leaves by itself.',
    }
    : {
      button: 'Не все квесты?', close: 'Закрыть',
      missingTitle: 'Не хватает квеста',
      missing: `Нажмите «${scan}», откройте в игре «Персонаж» → «Задания» и медленно пролистайте весь список сверху донизу: квест добавится сам.`,
      extraTitle: 'Лишний квест',
      extra: 'Сделайте то же самое: чего нет в списке игры, уйдёт само.',
    }
}

export function QuestsHelpButton({ locale }: { locale: 'ru' | 'en' }) {
  const [open, setOpen] = useState(false)
  const text = questsHelpText(locale)
  return <>
    <button type="button" className="button small" data-testid="quests-help" aria-haspopup="dialog" onClick={() => setOpen(true)}><CircleHelp size={14} aria-hidden="true" /> {text.button}</button>
    {open && <QuestsHelpDialog text={text} onClose={() => setOpen(false)} />}
  </>
}

function QuestsHelpDialog({ text, onClose }: { text: ReturnType<typeof questsHelpText>; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(<div className="registration-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel registration-dialog quests-help-dialog" role="dialog" aria-modal="true" aria-labelledby="quests-help-title">
      <button type="button" className="registration-close" onClick={onClose} aria-label={text.close}><X size={18} /></button>
      <h2 id="quests-help-title">{text.button}</h2>
      <div className="quests-help-case"><h3>{text.missingTitle}</h3><p>{text.missing}</p></div>
      <div className="quests-help-case"><h3>{text.extraTitle}</h3><p>{text.extra}</p></div>
    </section>
  </div>, document.body)
}
