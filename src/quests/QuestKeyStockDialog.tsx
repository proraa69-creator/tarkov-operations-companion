import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { KeyRound, Plus, X } from 'lucide-react'
import type { Item, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { setOwnedKey } from './ownedKeys'

/**
 * «Нет в наличии» on a key of «Ключи для квестов», pressed (owner, 18.11.2026: «на нее можно нажать, появится окно, и
 * можно нажать „Добавить в наличие“»): the key joins the keys in the stash of this profile and mode, one piece.
 */
export function QuestKeyStockDialog({ item, profileId, mode, onClose }: { item: Item; profileId: string; mode: RaidMode; onClose: () => void }) {
  const titleId = useId()
  const addRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    addRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const add = () => {
    setOwnedKey(profileId, mode, item.id, 1)
    onClose()
  }
  return createPortal(
    <div className="registration-overlay quest-key-stock-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog quest-key-stock-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2 id={titleId}>{uiText('Нет в наличии')}</h2>
        <div className="quest-key-barter-key">
          {item.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={22} aria-hidden="true" />}
          <strong>{uiText(item.name)}</strong>
        </div>
        <button ref={addRef} type="button" className="button primary" onClick={add}><Plus size={15} aria-hidden="true" />{uiText('Добавить в наличие')}</button>
      </section>
    </div>,
    document.body,
  )
}
