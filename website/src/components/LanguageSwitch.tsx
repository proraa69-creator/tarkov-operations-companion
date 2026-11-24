import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { SITE_LOCALES, setSiteLocale, tr, useSiteLocale } from '../i18n'
import '../i18n/languageSwitch.css'

/**
 * The site's language, right of «Личный кабинет» (src/i18n/index.ts): a button with the language's two letters that opens
 * the list of every language by its own name (owner, 24.11.2026: «окно со списком всех языков … в стиле приложения»).
 */
export function LanguageSwitch() {
  const locale = useSiteLocale()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const list = useId()
  const current = SITE_LOCALES.find((option) => option.code === locale) ?? SITE_LOCALES[0]!

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    box.current?.querySelector<HTMLButtonElement>('.lang-menu button.is-active')?.focus()
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  const arrows = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    buttons[(at + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus()
  }

  return <div ref={box} className="lang-picker" translate="no">
    <button type="button" className="lang-switch lang-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-controls={list}
      aria-label={tr('Язык сайта')} title={current.name} onClick={() => setOpen((value) => !value)}>
      <span>{current.short}</span><ChevronDown size={13} aria-hidden="true" className={open ? 'is-open' : undefined} />
    </button>
    {open && <div id={list} className="lang-menu" role="listbox" aria-label={tr('Язык сайта')} onKeyDown={arrows}>
      {SITE_LOCALES.map((option) => <button key={option.code} type="button" role="option" lang={option.tag} aria-selected={option.code === locale}
        className={option.code === locale ? 'is-active' : undefined} onClick={() => { setSiteLocale(option.code); setOpen(false) }}>
        <span className="lang-code">{option.short}</span>
        <span className="lang-name">{option.name}</span>
        {option.code === locale ? <Check size={14} aria-hidden="true" /> : <span aria-hidden="true" />}
      </button>)}
    </div>}
  </div>
}
