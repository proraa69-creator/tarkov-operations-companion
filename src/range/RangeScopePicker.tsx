import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Crosshair } from 'lucide-react'
import { CellPicture } from '../arsenal/BuildBench'
import type { GunPart } from '../arsenal/gunTypes'
import type { ScopeData } from './rangeScope'

/**
 * The range's scope list with each scope's picture (owner, 23.11.2026: «когда нажимаешь и вылезает список вниз, добавить картинки
 * каждого прицела, как он выглядит»). A browser's own list shows no pictures, so this one is the app's: the picture of the
 * scope from the catalog (the same as the build's cells), its name and magnification; Escape or a click elsewhere closes it.
 */
export function RangeScopePicker({ scopes, value, onChange, parts, lang }: {
  scopes: ScopeData[]
  value: string
  onChange: (id: string) => void
  /** The catalog's parts: a scope's picture by its id. */
  parts: Map<string, GunPart>
  lang: 'ru' | 'en'
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    // the chosen one in view as the list opens
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const current = scopes.find((entry) => entry.id === value)
  const name = (scope: ScopeData) => lang === 'en' ? scope.en : scope.ru
  const zooms = (scope: ScopeData) => [...new Set(scope.modes.map((mode) => mode.zoomMax && mode.zoomMax > mode.zoom ? `×${mode.zoom}–${mode.zoomMax}` : `×${mode.zoom}`))].join(' / ')
  const pick = (id: string) => { onChange(id); setOpen(false) }
  return <div className="range-scope-picker" ref={box}>
    <button type="button" className="select range-scope-picker-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
      <ScopePicture part={current ? parts.get(current.id) : undefined} />
      <span className="range-scope-picker-name">{current ? name(current) : t('Без оптики', 'No optic')}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <ul ref={list} role="listbox" className="range-scope-list" aria-label={t('Прицел', 'Scope')}>
      <li role="option" aria-selected={!value}>
        <button type="button" onClick={() => pick('')}>
          <ScopePicture />
          <span className="range-scope-option-name">{t('Без оптики', 'No optic')}</span>
          {!value && <Check size={14} aria-hidden="true" />}
        </button>
      </li>
      {scopes.map((scope) => <li key={scope.id} role="option" aria-selected={scope.id === value}>
        <button type="button" onClick={() => pick(scope.id)}>
          <ScopePicture part={parts.get(scope.id)} />
          <span className="range-scope-option-name">{name(scope)}<small>{zooms(scope)}</small></span>
          {scope.id === value && <Check size={14} aria-hidden="true" />}
        </button>
      </li>)}
    </ul>}
  </div>
}

function ScopePicture({ part }: { part?: GunPart }) {
  return <span className="range-scope-thumb">{part ? <CellPicture part={part} /> : <Crosshair size={16} aria-hidden="true" />}</span>
}
