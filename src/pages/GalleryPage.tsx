import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Loader2, RotateCcw, RotateCw, X } from 'lucide-react'
import { allBossFigures, bossMapIds } from '../data/bossFigures'
import { BOSS_MODEL_FIX, bossModelUrl } from '../data/bossModels'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { useLocale } from '../i18n/LocaleProvider'
import { useReducedMotion } from '../theme/gear/useGearActive'
import type { BossViewerHandle } from '../gallery/bossViewer3d'

const SPIN_STORAGE_KEY = 'tarkov-gallery-spin-v1'
const figures = allBossFigures().filter((figure) => bossModelUrl(figure.key))

function readSpin() {
  try { return localStorage.getItem(SPIN_STORAGE_KEY) === '1' } catch { return false }
}

/**
 * «Галерея»: every boss model the owner made. The grid shows the light pre-rendered stills; only the opened
 * boss gets a live 3D viewer (three.js is imported on open and freed on close).
 */
export function GalleryPage() {
  const { locale } = useLocale()
  const [openKey, setOpenKey] = useState<string | null>(null)
  return <div className="page gallery-page">
    <header className="page-header"><div>
      <div className="eyebrow">{uiText('Боссы · 3D модели')}</div>
      <h1 className="page-title">{uiText('Галерея')}</h1>
      <p className="page-subtitle">{uiText('Все модели боссов. Откройте карточку и вращайте модель мышью; колесо — приблизить.')}</p>
    </div></header>
    <div className="gallery-grid">
      {figures.map((figure) => {
        const maps = bossMapIds(figure.key)
        return <button type="button" key={figure.key} className="gallery-card" onClick={() => setOpenKey(figure.key)}>
          <span className="gallery-card-stage"><img src={figure.url} alt="" loading="lazy" decoding="async" /></span>
          <span className="gallery-card-name">{figure.name[locale]}</span>
          <span className="gallery-card-maps">{maps.length ? maps.map((id) => uiText(MAP_DISPLAY_NAMES[id] ?? id)).join(' · ') : uiText('Вне карт')}</span>
        </button>
      })}
    </div>
    {openKey && <BossViewerDialog
      bossKey={openKey}
      onClose={() => setOpenKey(null)}
      onStep={(step) => setOpenKey((current) => {
        const index = figures.findIndex((figure) => figure.key === current)
        return figures[(index + step + figures.length) % figures.length].key
      })}
    />}
  </div>
}

function BossViewerDialog({ bossKey, onClose, onStep }: { bossKey: string; onClose: () => void; onStep: (step: number) => void }) {
  const { locale } = useLocale()
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<BossViewerHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [spin, setSpin] = useState(readSpin)
  const spinRef = useRef(spin)
  const figure = figures.find((entry) => entry.key === bossKey)

  // One viewer for the dialog's lifetime; switching bosses only swaps the model.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.focus({ preventScroll: true })
    let cancelled = false
    import('../gallery/bossViewer3d')
      .then(({ mountBossViewer }) => {
        if (cancelled) return
        handleRef.current = mountBossViewer(canvas, { reduced, onLoading: (busy) => { setLoading(busy); if (busy) setFailed(false) }, onError: () => setFailed(true) })
        handleRef.current.setSpin(spinRef.current)
        setReady(true)
      })
      .catch(() => { setFailed(true); setLoading(false) })
    return () => {
      cancelled = true
      handleRef.current?.dispose()
      handleRef.current = null
      setReady(false)
    }
  }, [reduced])

  useEffect(() => {
    const url = bossModelUrl(bossKey)
    if (!ready || !url) return
    handleRef.current?.load(url, BOSS_MODEL_FIX[bossKey])
  }, [bossKey, ready])

  useEffect(() => {
    spinRef.current = spin
    handleRef.current?.setSpin(spin)
    try { localStorage.setItem(SPIN_STORAGE_KEY, spin ? '1' : '0') } catch { /* per-viewer convenience only */ }
  }, [spin])

  const onKey = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'PageDown' || (event.key === 'ArrowRight' && event.shiftKey)) onStep(1)
    else if (event.key === 'PageUp' || (event.key === 'ArrowLeft' && event.shiftKey)) onStep(-1)
  }, [onClose, onStep])
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const maps = bossMapIds(bossKey)
  // Portalled to <body>: the page's entry animation would otherwise trap position: fixed inside it.
  return createPortal(<div className="gallery-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="gallery-viewer panel" role="dialog" aria-modal="true" aria-label={figure?.name[locale]}>
      <header className="gallery-viewer-head">
        <div>
          <div className="eyebrow">{maps.map((id) => uiText(MAP_DISPLAY_NAMES[id] ?? id)).join(' · ') || uiText('Боссы')}</div>
          <h2 className="gallery-viewer-title">{figure?.name[locale] ?? bossKey}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={17} /></button>
      </header>
      <div className="gallery-viewer-stage">
        {/* The still shows instantly and stays until the model is on screen. */}
        {figure && (loading || failed) && <img className="gallery-viewer-still" src={figure.url} alt="" />}
        <canvas ref={canvasRef} tabIndex={0} aria-label={uiText('3D модель: перетащите, чтобы повернуть')} className={loading || failed ? 'is-hidden' : ''} />
        {loading && !failed && <span className="gallery-viewer-status"><Loader2 size={14} className="spin" /> {uiText('Загрузка модели…')}</span>}
        {failed && <span className="gallery-viewer-status is-error">{uiText('Не удалось загрузить 3D модель')}</span>}
        <button type="button" className="gallery-viewer-step is-prev" onClick={() => onStep(-1)} aria-label={uiText('Предыдущий босс')} title={uiText('Предыдущий босс')}><ChevronLeft size={22} /></button>
        <button type="button" className="gallery-viewer-step is-next" onClick={() => onStep(1)} aria-label={uiText('Следующий босс')} title={uiText('Следующий босс')}><ChevronRight size={22} /></button>
      </div>
      <footer className="gallery-viewer-foot">
        <span className="gallery-viewer-hint">{uiText('Перетащите — повернуть · колесо — масштаб · двойной клик — сброс')}</span>
        <div className="gallery-viewer-actions">
          {!reduced && <button type="button" className={`button ghost${spin ? ' is-on' : ''}`} aria-pressed={spin} onClick={() => setSpin((value) => !value)}><RotateCw size={14} /> {uiText('Автоповорот')}</button>}
          <button type="button" className="button ghost" onClick={() => handleRef.current?.resetView()}><RotateCcw size={14} /> {uiText('Сбросить вид')}</button>
        </div>
      </footer>
    </section>
  </div>, document.body)
}
