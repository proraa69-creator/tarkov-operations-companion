import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { countryName, searchCountries } from '../../../src/shared/countries'
import { siteLocale, tr } from '../i18n'
import './countrySelect.css'

/** Rows a Page Up / Page Down moves in the list. */
const PAGE = 8

/**
 * «Страна» of a registration form and of the cabinet (owner, 13.10.2026: «при регистрации нужно указать страну», then
 * «при нажатии выбора страны окно с ручным вводом» and «не разделяй СНГ, Европу и другие страны, просто общий список»):
 * the field opens a window with a search box over one list of every country, sorted by the name in the site's language.
 * Typing finds a country by its name in Russian or English, its code or a common other name (src/shared/countries.ts
 * searchCountries); arrows, Enter and Escape work as in a select. Nothing is chosen in advance, and a form is not sent
 * without a country: a hidden required input carries the code, and an empty one marks the field and says so.
 */
export function CountrySelect({ value, onChange, disabled = false }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const id = useId()
  const ids = { trigger: `${id}-field`, label: `${id}-label`, hint: `${id}-hint`, error: `${id}-error`, window: `${id}-window`, list: `${id}-list` }
  const locale = siteLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [above, setAbove] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const centerNext = useRef(false)
  const results = useMemo(() => searchCountries(query, locale), [query, locale])
  const selected = value ? countryName(value, locale) : ''

  const openWindow = (text = '') => {
    if (disabled) return
    // Opens upwards when there is no room below the field (the cabinet's last panel, a short window).
    const box = trigger.current?.getBoundingClientRect()
    const below = box ? window.innerHeight - box.bottom : Infinity
    setAbove(Boolean(box && below < 330 && box.top > below))
    setQuery(text)
    setActive(text ? 0 : Math.max(0, searchCountries('', locale).findIndex((option) => option.code === value)))
    centerNext.current = !text
    setOpen(true)
  }
  const close = (focusField: boolean) => {
    setOpen(false)
    setQuery('')
    if (focusField) trigger.current?.focus()
  }
  const choose = (code: string) => {
    onChange(code)
    setInvalid(false)
    close(true)
  }

  useEffect(() => { if (open) search.current?.focus() }, [open])
  // The active country stays in view: centred when the window opens on the chosen one, then just scrolled to.
  useEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (!open || !box || !row) return
    if (centerNext.current) {
      centerNext.current = false
      box.scrollTop = row.offsetTop - (box.clientHeight - row.offsetHeight) / 2
    } else if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
  }, [open, active, results])
  // A press outside the field closes the window.
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return
      setOpen(false)
      setQuery('')
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const onFieldKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openWindow()
    } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Typing on the field starts the search with that letter.
      event.preventDefault()
      openWindow(event.key)
    }
  }
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = results.length - 1
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, last)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
    else if (event.key === 'PageDown') { event.preventDefault(); setActive((index) => Math.min(index + PAGE, last)) }
    else if (event.key === 'PageUp') { event.preventDefault(); setActive((index) => Math.max(index - PAGE, 0)) }
    else if (event.key === 'Enter') {
      // Never sends the form: Enter picks the highlighted country.
      event.preventDefault()
      const option = results[active]
      if (option) choose(option.code)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') close(false)
  }
  const activeOption = results[active]

  return (
    <div className="field country-select" ref={root} onBlur={(event) => {
      if (open && !root.current?.contains(event.relatedTarget as Node | null)) close(false)
    }}>
      <label className="field-label" id={ids.label} htmlFor={ids.trigger}>{tr('Страна')}</label>
      <div className="country-select-box">
        <button ref={trigger} id={ids.trigger} type="button" role="combobox" disabled={disabled}
          className={`input country-select-field${invalid ? ' is-invalid' : ''}`}
          aria-labelledby={ids.label} aria-describedby={invalid ? `${ids.error} ${ids.hint}` : ids.hint}
          aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? ids.window : undefined} aria-required="true" aria-invalid={invalid || undefined}
          // Safari does not focus a pressed button: the search box keeps the focus until the click closes the window.
          onMouseDown={(event) => { if (open) event.preventDefault() }}
          onClick={() => (open ? close(true) : openWindow())} onKeyDown={onFieldKey}>
          <span className={selected ? 'country-select-value' : 'country-select-placeholder'}>{selected || tr('Выберите страну')}</span>
          <ChevronDown className="country-select-chevron" aria-hidden="true" />
        </button>
        <input className="country-select-required" tabIndex={-1} aria-hidden="true" required={!disabled} disabled={disabled} value={value}
          onChange={() => {}} onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus() }} />
        {open && (
          <div id={ids.window} role="dialog" aria-label={tr('Выбор страны')} className={`country-select-window${above ? ' is-above' : ''}`}
            onMouseDown={(event) => { if (event.target !== search.current) event.preventDefault() }}>
            <div className="country-select-search">
              <Search aria-hidden="true" />
              <input ref={search} type="text" role="combobox" className="country-select-input" value={query}
                aria-label={tr('Поиск страны')} aria-autocomplete="list" aria-expanded="true" aria-controls={ids.list}
                aria-activedescendant={activeOption ? `${id}-${activeOption.code}` : undefined}
                placeholder={tr('Начните вводить название')} autoComplete="off" spellCheck={false} enterKeyHint="done"
                onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={onSearchKey} />
            </div>
            <ul ref={list} id={ids.list} role="listbox" aria-label={tr('Страны')} className="country-select-list">
              {results.map((option, index) => (
                <li key={option.code} id={`${id}-${option.code}`} role="option" aria-selected={option.code === value} data-active={index === active}
                  className="country-select-option" onMouseMove={() => setActive(index)} onClick={() => choose(option.code)}>
                  <span>{option.name}</span>
                  {option.code === value && <Check aria-hidden="true" />}
                </li>
              ))}
            </ul>
            {!results.length && <p className="country-select-empty" role="status">{tr('Ничего не найдено')}</p>}
          </div>
        )}
      </div>
      {invalid && <span className="field-error" id={ids.error} role="alert">{tr('Выберите страну.')}</span>}
      <span className="field-hint" id={ids.hint}>{tr('Для статистики по регионам и выбора способов оплаты.')}</span>
    </div>
  )
}
