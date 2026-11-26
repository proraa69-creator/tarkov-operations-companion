import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { Item, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { setOwnedKey } from './ownedKeys'

/**
 * A key's stock tag on «Ключи для квестов», pressed — the left or the right button — opens a small box right under it,
 * nothing dimmed (owner, 25.11.2026: «не открывается окно на весь экран и не притемняет, а прям там же открывается окошечко
 * „Добавить в наличие“. И ты нажимаешь „Добавить“»):
 *  - «Нет в наличии»: «Добавить в наличие» and «Добавить» put one piece of the key in the stash of this profile and mode;
 *  - «Есть в схроне» (owner, 25.11.2026: «если ключ в наличии, также нажимает на это окно и нажать „Нет в наличии“»): its
 *    «Нет в наличии» takes the key off the list.
 * A click elsewhere, Escape or the tag again closes it.
 */
export function QuestKeyStockButton({ item, profileId, mode, owned = false, usesLeft }: {
  item: Pick<Item, 'id'>
  profileId: string
  mode: RaidMode
  owned?: boolean
  /** «Есть в схроне · 3/10»: the uses left of a key that wears out. */
  usesLeft?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const actionRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    actionRef.current?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key) }
  }, [open])
  const apply = () => {
    setOwnedKey(profileId, mode, item.id, owned ? 0 : 1)
    setOpen(false)
  }
  // The right button opens the same box (and never the browser's own menu over it).
  const openByRightButton = (event: MouseEvent) => { event.preventDefault(); setOpen(true) }
  const tag = owned ? `${uiText('Есть в схроне')}${usesLeft ? ` · ${usesLeft}` : ''}` : uiText('Нет в наличии')
  return (
    <span className="quest-key-stock" ref={root}>
      <button type="button" className={owned ? 'tag green quest-key-owned' : 'tag quest-key-missing'} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((state) => !state)} onContextMenu={openByRightButton}>{tag}</button>
      {open && (owned
        ? (
          <div className="quest-key-stock-pop" role="dialog" aria-label={uiText('Нет в наличии')}>
            <button ref={actionRef} type="button" className="button small" onClick={apply}><Minus size={14} aria-hidden="true" />{uiText('Нет в наличии')}</button>
          </div>
        )
        : (
          <div className="quest-key-stock-pop" role="dialog" aria-labelledby={titleId}>
            <span id={titleId}>{uiText('Добавить в наличие')}</span>
            <button ref={actionRef} type="button" className="button small primary" onClick={apply}><Plus size={14} aria-hidden="true" />{uiText('Добавить')}</button>
          </div>
        ))}
    </span>
  )
}
