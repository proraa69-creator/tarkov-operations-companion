import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, LoaderCircle, PenLine, Search } from 'lucide-react'
import { cleanManualCountry, countryByName, countryName, MANUAL_COUNTRY_MAX, searchCountries, type CountryLocale } from '../shared/countries'
import './countryPicker.css'

/** What the player chose: a listed country, or one typed by hand («Моей страны нет в списке»). */
export type CountryChoice = { country: string } | { other: string }

/** Rows a Page Up / Page Down moves in the list. */
const PAGE = 8

/**
 * The country list of «Укажите страну» (owner, 15.10.2026: «проконтролируй что бы они смогли выбрать страну и что бы был
 * выбор вручную написать»), in the app's window (src/account/CountryGate.tsx) and the website's
 * (website/src/components/CountryGateDialog.tsx). The same flat list with a search as the website's registration picker
 * (website/src/components/CountrySelect.tsx, src/shared/countries.ts searchCountries: Russian or English names, the code,
 * common other names), shown open in the window, plus «Моей страны нет в списке — ввести вручную»: a text field checked as
 * the server checks it (cleanManualCountry: letters, spaces and hyphens, up to 60). A typed name of a listed country
 * («Казахстан», «USA») is saved as that country, and the field says so. `t`: the caller's translation of the Russian
 * texts (the app's uiLabel, the website's tr).
 */
export function CountryPicker({ locale, t, busy = false, onSubmit }: {
  locale: CountryLocale
  t: (ru: string) => string
  busy?: boolean
  onSubmit: (choice: CountryChoice) => void
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [selected, setSelected] = useState('')
  const [manual, setManual] = useState(false)
  const [typed, setTyped] = useState('')
  const [touched, setTouched] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const manualField = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const results = useMemo(() => searchCountries(query, locale), [query, locale])
  const cleaned = cleanManualCountry(typed)
  const known = cleaned ? countryByName(cleaned) : undefined

  useEffect(() => { (manual ? manualField : search).current?.focus() }, [manual])
  // The highlighted country stays in view while the arrows move it.
  useEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (!box || !row) return
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight
  }, [active, results])

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = results.length - 1
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(index + 1, last)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)) }
    else if (event.key === 'PageDown') { event.preventDefault(); setActive((index) => Math.min(index + PAGE, last)) }
    else if (event.key === 'PageUp') { event.preventDefault(); setActive((index) => Math.max(index - PAGE, 0)) }
    else if (event.key === 'Enter') {
      // Enter picks the highlighted country; a second Enter on it saves.
      event.preventDefault()
      const option = results[active]
      if (!option) return
      if (option.code === selected) onSubmit({ country: option.code })
      else setSelected(option.code)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (manual) {
      setTouched(true)
      if (cleaned) onSubmit({ other: cleaned })
    } else if (selected) onSubmit({ country: selected })
  }
  const activeOption = results[active]
  const invalid = manual && touched && !cleaned

  return (
    <form className="country-picker" onSubmit={submit} noValidate>
      {!manual ? <>
        <div className="country-picker-search">
          <Search aria-hidden="true" />
          <input ref={search} type="text" role="combobox" className="country-picker-input" value={query} disabled={busy}
            aria-label={t('Поиск страны')} aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-list`}
            aria-activedescendant={activeOption ? `${id}-${activeOption.code}` : undefined}
            placeholder={t('Начните вводить название')} autoComplete="off" spellCheck={false} enterKeyHint="done"
            onChange={(event) => { setQuery(event.target.value); setActive(0) }} onKeyDown={onSearchKey} />
        </div>
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label={t('Страны')} className="country-picker-list">
          {results.map((option, index) => (
            <li key={option.code} id={`${id}-${option.code}`} role="option" aria-selected={option.code === selected} data-active={index === active}
              className="country-picker-option" onMouseMove={() => setActive(index)} onClick={() => { if (!busy) { setSelected(option.code); setActive(index) } }}>
              <span>{option.name}</span>
              {option.code === selected && <Check aria-hidden="true" />}
            </li>
          ))}
          {!results.length && <li className="country-picker-empty" role="presentation">{t('Ничего не найдено')}</li>}
        </ul>
        <button type="button" className="country-picker-manual-toggle" disabled={busy} onClick={() => { setManual(true); setTyped(query.trim()); setTouched(false) }}>
          <PenLine aria-hidden="true" />{t('Моей страны нет в списке — ввести вручную')}
        </button>
      </> : <>
        <label className="country-picker-manual">
          <span id={`${id}-manual-label`} className="country-picker-label">{t('Название страны')}</span>
          <input ref={manualField} type="text" className={`country-picker-text${invalid ? ' is-invalid' : ''}`} value={typed} disabled={busy}
            maxLength={MANUAL_COUNTRY_MAX + 20} autoComplete="country-name" spellCheck={false} aria-invalid={invalid || undefined}
            aria-labelledby={`${id}-manual-label`} aria-describedby={`${id}-manual-hint`} onChange={(event) => setTyped(event.target.value)} onBlur={() => setTouched(Boolean(typed.trim()))} />
          <span id={`${id}-manual-hint`} className={invalid ? 'country-picker-error' : 'country-picker-hint'} role={invalid ? 'alert' : undefined}>
            {invalid ? t('Только буквы, пробелы и дефисы, до 60 символов.')
              : known ? `${t('Есть в списке:')} ${countryName(known, locale)}` : t('Только буквы, пробелы и дефисы, до 60 символов.')}
          </span>
        </label>
        <button type="button" className="country-picker-manual-toggle" disabled={busy} onClick={() => setManual(false)}>
          <Search aria-hidden="true" />{t('Выбрать из списка')}
        </button>
      </>}
      <button type="submit" className="button primary country-picker-submit" disabled={busy || (manual ? !typed.trim() : !selected)}>
        {busy && <LoaderCircle className="spin spinner" aria-hidden="true" />}
        {manual || !selected ? t('Сохранить') : `${t('Сохранить')}: ${countryName(selected, locale)}`}
      </button>
    </form>
  )
}
