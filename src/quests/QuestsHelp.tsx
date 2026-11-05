import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, X } from 'lucide-react'
import { manualAddText } from './ManualAdd'
import './manualMarks.css'

/**
 * «Не хватает квеста?» beside «Найти квесты по экрану» (owner, 04.11.2026: «объясни людям, что из-за того, что логи удаляются
 * периодически … добавить вручную, если их небольшое количество. Если большое количество квестов не хватает, то рекомендуй
 * просканировать экран … по пунктам. И коротко»). It names the real buttons by their own labels, so it cannot drift from them.
 * An extra quest is the right click's business: «У меня нет этого квеста» (src/components/DeferredQuests.tsx).
 */
export function questsHelpText(locale: 'ru' | 'en') {
  const manual = manualAddText(locale).button
  return locale === 'en'
    ? {
      button: 'Missing a quest?', close: 'Close',
      why: 'Quests come from the game\'s logs, and the game deletes old logs from time to time. Because of this, not every quest is found.',
      few: { when: 'A few are missing:', then: `press «${manual}» and tick them.` },
      many: { when: 'Many are missing:', then: 'press «Find quests on screen» and scroll through «Character» → «Tasks» in the game.' },
    }
    : {
      button: 'Не хватает квеста?', close: 'Закрыть',
      why: 'Квесты берутся из логов игры, а игра периодически удаляет старые логи. Из-за этого обнаруживаются не все квесты.',
      few: { when: 'Не хватает нескольких:', then: `нажмите «${manual}» и отметьте их.` },
      many: { when: 'Не хватает многих:', then: 'нажмите «Найти квесты по экрану» и пролистайте в игре «Персонаж» → «Задания».' },
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
      <p>{text.why}</p>
      <ol className="quests-help-steps">
        <li><strong>{text.few.when}</strong> {text.few.then}</li>
        <li><strong>{text.many.when}</strong> {text.many.then}</li>
      </ol>
    </section>
  </div>, document.body)
}
