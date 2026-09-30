import { useEffect, useRef, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { THEMES, THEME_CHANGED_EVENT, applyAppearance, currentTheme, saveAppearance } from '../theme/theme'
import '../styles/themePicker.css'
import { StitchChooser } from '../theme/alcantara/StitchChooser'

/** Thumbnails of the real interface in every theme (scripts/theme-previews.mjs). */
const previews = import.meta.glob<string>('../assets/theme-previews/*.webp', { eager: true, import: 'default' })
const previewOf = (id: string) => previews[`../assets/theme-previews/${id}.webp`]

/**
 * Settings → «Цветовая схема». «Выбрать» slides the block open; a click on a scheme puts it on at once (a preview) and
 * the button turns into «ОК», which keeps the scheme and slides the block shut. Leaving the page without «ОК» brings
 * the saved scheme back.
 */
export function ThemePicker() {
  const [saved, setSaved] = useState(currentTheme)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])

  useEffect(() => {
    // the top-bar button or the server sync changed the scheme: that one wins over an unconfirmed preview
    const sync = () => { setSaved(currentTheme()); setDraft(null) }
    window.addEventListener(THEME_CHANGED_EVENT, sync)
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, sync)
      if (draftRef.current) applyAppearance(currentTheme())
    }
  }, [])

  const shown = draft ?? saved
  const shownLabel = THEMES.find((theme) => theme.id === shown)?.label ?? ''
  const confirming = open && draft !== null

  const pick = (id: string) => {
    setDraft(id)
    applyAppearance(id)
  }
  const press = () => {
    if (!open) { setOpen(true); return }
    if (draft !== null) {
      draftRef.current = null
      saveAppearance(draft)
      setSaved(draft)
      setDraft(null)
      window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
    }
    setOpen(false)
  }

  return (
    <div className="theme-chooser">
      <div className="setting-row theme-chooser-row">
        <span>
          <strong>{uiText('Цветовая схема')}</strong>
          <small>{uiText('Оформление оболочки приложения')}</small>
          <span className="theme-chooser-current">
            {previewOf(shown) && <img src={previewOf(shown)} alt="" width={40} height={24} />}
            {uiText(shownLabel)}
          </span>
        </span>
        <button type="button" className={`button small theme-chooser-button${confirming ? ' primary' : ''}`} aria-expanded={open} aria-controls="theme-chooser-grid" onClick={press}>
          {confirming ? <Check size={14} /> : <Palette size={14} />}
          {confirming ? uiText('ОК') : uiText('Выбрать')}
        </button>
      </div>
      {shown === 'alcantara' && <StitchChooser />}
      <div className={`theme-chooser-drawer${open ? ' is-open' : ''}`} inert={!open}>
        <div className="theme-chooser-inner">
          <div id="theme-chooser-grid" className="theme-chooser-grid" role="radiogroup" aria-label={uiText('Цветовая схема')}>
            {THEMES.map((option) => {
              const active = shown === option.id
              const url = previewOf(option.id)
              return (
                <button key={option.id} type="button" role="radio" aria-checked={active} className={`theme-card${active ? ' is-active' : ''}`} onClick={() => pick(option.id)} title={uiText(option.label)}>
                  <span className="theme-card-shot">
                    {url
                      ? <img src={url} alt="" width={200} height={120} loading="lazy" draggable={false} />
                      : <span className="theme-card-fallback" style={{ background: `linear-gradient(135deg, ${option.swatch[0]} 0 45%, ${option.swatch[1]} 45% 75%, ${option.swatch[2]} 75%)` }} />}
                    {active && <span className="theme-card-check"><Check size={12} /></span>}
                  </span>
                  <span className="theme-card-name">{uiText(option.label)}</span>
                </button>
              )
            })}
          </div>
          <p className="theme-chooser-hint">{uiText(draft !== null ? 'Схема включена для просмотра. Нажмите «ОК», чтобы оставить её.' : 'Нажмите на схему — она сразу применится.')}</p>
        </div>
      </div>
    </div>
  )
}
