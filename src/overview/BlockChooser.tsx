import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'

export interface BlockChoice {
  id: string
  label: string
  /** 'here': the block of this place; 'shown': elsewhere on the Overview (they trade places); 'hidden': off the screen now. */
  state: 'here' | 'shown' | 'hidden'
}

/**
 * «Заменить блок» (owner, 11.11.2026: «Нажимаешь настроить… появляется кнопка настройки. Нажимаешь кнопку настройки, и появляется
 * окно с выбором блока, какой нужно поставить вместо текущего»): every block that can stand in this place; the one there now is
 * ticked. Escape, the cross or a press beside it closes it.
 */
export function BlockChooser({ title, choices, onPick, onClose }: { title: string; choices: readonly BlockChoice[]; onPick: (id: string) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="block-chooser-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel block-chooser" role="dialog" aria-modal="true" aria-label={uiText('Заменить блок')}>
        <header className="block-chooser-head">
          <div><strong>{uiText('Заменить блок')}</strong><small className="dim">{uiText(title)}</small></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={16} /></button>
        </header>
        <ul className="block-chooser-list">
          {choices.map((choice) => (
            <li key={choice.id}>
              <button type="button" className={choice.state === 'here' ? 'is-here' : undefined} aria-current={choice.state === 'here' || undefined}
                onClick={() => (choice.state === 'here' ? onClose() : onPick(choice.id))}>
                <span>{uiText(choice.label)}</span>
                {choice.state === 'here' ? <Check size={16} aria-hidden="true" /> : <small className="dim">{uiText(choice.state === 'shown' ? 'поменяются местами' : 'встанет сюда')}</small>}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>,
    document.body,
  )
}
