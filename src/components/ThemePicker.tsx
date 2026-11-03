import { useEffect, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { THEMES, THEME_CHANGED_EVENT, currentTheme, saveAppearance } from '../theme/theme'
import '../styles/themePicker.css'
import { StitchChooser } from '../theme/alcantara/StitchChooser'

/** Thumbnails of the real interface in every theme (scripts/theme-previews.mjs). */
const previews = import.meta.glob<string>('../assets/theme-previews/*.webp', { eager: true, import: 'default' })
const previewOf = (id: string) => previews[`../assets/theme-previews/${id}.webp`]

/**
 * Settings → «Цветовая схема». «Выбрать» slides the block open; a click on a scheme puts it on and keeps it at once
 * (owner, 01.11.2026: «когда выбираешь тему и переходишь на другую вкладку выбранная тобою тема не сохраняется» — it
 * used to be a preview kept only by «ОК»); «Готово» slides the block shut.
 */
export function ThemePicker() {
  const [shown, setShown] = useState(currentTheme)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // the top-bar button or the server sync changed the scheme
    const sync = () => setShown(currentTheme())
    window.addEventListener(THEME_CHANGED_EVENT, sync)
    return () => window.removeEventListener(THEME_CHANGED_EVENT, sync)
  }, [])

  const shownLabel = THEMES.find((theme) => theme.id === shown)?.label ?? ''

  const pick = (id: string) => {
    saveAppearance(id)
    setShown(id)
    window.dispatchEvent(new Event(THEME_CHANGED_EVENT))
  }
  const press = () => setOpen((value) => !value)

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
        <button type="button" className={`button small theme-chooser-button${open ? ' primary' : ''}`} aria-expanded={open} aria-controls="theme-chooser-grid" onClick={press}>
          {open ? <Check size={14} /> : <Palette size={14} />}
          {open ? uiText('Готово') : uiText('Выбрать')}
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
          <p className="theme-chooser-hint">{uiText('Нажмите на схему — она сразу применится и сохранится.')}</p>
        </div>
      </div>
    </div>
  )
}
