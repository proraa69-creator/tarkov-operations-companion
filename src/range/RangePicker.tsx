import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Crosshair } from 'lucide-react'

export interface PickerItem {
  id: string
  name: string
  /** A second line: a scope's magnifications, an armour's class. */
  sub?: string
  picture?: ReactNode
}

export interface PickerGroup {
  title?: string
  items: PickerItem[]
}

/**
 * A list with each entry's picture (owner, 23.11.2026: «когда нажимаешь и вылезает список вниз, добавить картинки каждого прицела»;
 * then «картинки шлемов и бронеразгрузок или бронежилетов»): a browser's own list shows no pictures, so this one is the app's.
 * Groups under their titles, «Нет» first when `none` is given, a tick on the chosen one; Escape or a click elsewhere closes it.
 */
export function RangePicker({ groups, value, onChange, none, label }: {
  groups: PickerGroup[]
  value: string
  onChange: (id: string) => void
  /** The entry for nothing chosen («Без оптики», «Нет»), if any. */
  none?: string
  label: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = groups.flatMap((group) => group.items).find((item) => item.id === value)
  const pick = (id: string) => { onChange(id); setOpen(false) }
  const row = (item: PickerItem) => <li key={item.id} role="option" aria-selected={item.id === value}>
    <button type="button" onClick={() => pick(item.id)}>
      <span className="range-pick-thumb">{item.picture ?? <Crosshair size={16} aria-hidden="true" />}</span>
      <span className="range-pick-name">{item.name}{item.sub && <small>{item.sub}</small>}</span>
      {item.id === value && <Check size={14} aria-hidden="true" />}
    </button>
  </li>
  return <div className="range-picker" ref={box}>
    <button type="button" className="select range-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>
      <span className="range-pick-thumb">{current?.picture ?? <Crosshair size={16} aria-hidden="true" />}</span>
      <span className="range-picker-name">{current?.name ?? none ?? '—'}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <ul ref={list} role="listbox" className="range-pick-list" aria-label={label}>
      {none !== undefined && <li role="option" aria-selected={!value}>
        <button type="button" onClick={() => pick('')}>
          <span className="range-pick-thumb"><Crosshair size={16} aria-hidden="true" /></span>
          <span className="range-pick-name">{none}</span>
          {!value && <Check size={14} aria-hidden="true" />}
        </button>
      </li>}
      {groups.filter((group) => group.items.length).map((group, index) => [
        group.title ? <li key={`title-${index}`} role="presentation" className="range-pick-group">{group.title}</li> : null,
        ...group.items.map(row),
      ])}
    </ul>}
  </div>
}
