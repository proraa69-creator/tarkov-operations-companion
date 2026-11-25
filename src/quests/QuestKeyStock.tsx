import { useEffect, useId, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Item, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { setOwnedKey } from './ownedKeys'

/**
 * «Нет в наличии» on a key of «Ключи для квестов», pressed (owner, 18.11.2026: «на нее можно нажать… и можно нажать „Добавить в
 * наличие“»; 25.11.2026: «не открывается окно на весь экран и не притемняет, а прям там же открывается окошечко „Добавить в
 * наличие“. И ты нажимаешь „Добавить“. Все.»): a small box right under the tag, nothing dimmed; «Добавить» puts one piece of the
 * key in the stash of this profile and mode. A click elsewhere or Escape closes it.
 */
export function QuestKeyStockButton({ item, profileId, mode }: { item: Pick<Item, 'id'>; profileId: string; mode: RaidMode }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    addRef.current?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key) }
  }, [open])
  const add = () => {
    setOwnedKey(profileId, mode, item.id, 1)
    setOpen(false)
  }
  return (
    <span className="quest-key-stock" ref={root}>
      <button type="button" className="tag quest-key-missing" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((state) => !state)}>{uiText('Нет в наличии')}</button>
      {open && (
        <div className="quest-key-stock-pop" role="dialog" aria-labelledby={titleId}>
          <span id={titleId}>{uiText('Добавить в наличие')}</span>
          <button ref={addRef} type="button" className="button small primary" onClick={add}><Plus size={14} aria-hidden="true" />{uiText('Добавить')}</button>
        </div>
      )}
    </span>
  )
}
