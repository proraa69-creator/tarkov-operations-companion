import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { LANGUAGES, languageOption, type AppLanguage } from '../i18n/languages'
import { uiText } from '../i18n/renderText'
import '../styles/languagePicker.css'
import '../styles/languages.css'

/**
 * The language in the top bar (owner, 24.11.2026: «по нажатии на язык сверху у нас будет выдвигаться окно со списком
 * всех языков. Окно должно быть в стиле приложения, не просто белое окно»). The button shows the language's two
 * letters; the window lists every language by its own name. It is a `.locale-switch`, so every colour scheme and style
 * draws it like the other switches of the top bar.
 */
export function LanguagePicker() {
  const { language, setLocale } = useLocale()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useId()
  const current = languageOption(language)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    // The chosen language in focus, for the arrows.
    box.current?.querySelector<HTMLButtonElement>('.language-menu button.active')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  const choose = (next: AppLanguage) => { setLocale(next); setOpen(false) }
  const arrows = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }

  return <div ref={box} className="language-picker" translate="no">
    <div className="locale-switch">
      <button type="button" className="active language-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-controls={list}
        title={uiText('Язык интерфейса')} aria-label={`${uiText('Язык интерфейса')}: ${current.name}`} onClick={() => setOpen((value) => !value)}>
        <span>{current.short}</span><ChevronDown size={12} aria-hidden="true" className={open ? 'is-open' : undefined} />
      </button>
    </div>
    {open && <div id={list} className="locale-switch language-menu" role="listbox" aria-label={uiText('Язык интерфейса')} onKeyDown={arrows}>
      {LANGUAGES.map((option) => <button key={option.code} type="button" role="option" lang={option.tag} aria-selected={option.code === language}
        className={option.code === language ? 'active' : undefined} onClick={() => choose(option.code)}>
        <span className="language-code">{option.short}</span>
        <span className="language-name">{option.name}</span>
        {option.code === language ? <Check size={13} aria-hidden="true" /> : <span className="language-check" aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}

/** On a phone (the «Ещё» sheet, «Настройки»): every language as a button of its own, no window over the sheet. */
export function LanguageButtons() {
  const { language, setLocale } = useLocale()
  return <div className="locale-switch language-buttons" role="radiogroup" aria-label={uiText('Язык интерфейса')} translate="no">
    {LANGUAGES.map((option) => <button key={option.code} type="button" role="radio" aria-checked={option.code === language} lang={option.tag}
      title={option.name} className={option.code === language ? 'active' : undefined} onClick={() => setLocale(option.code)}>{option.short}</button>)}
  </div>
}
