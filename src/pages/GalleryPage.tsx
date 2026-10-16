import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Loader2, RotateCw, X } from 'lucide-react'
import { allBossFigures, bossMapIds, type BossFigure } from '../data/bossFigures'
import { GALLERY_BOSS_KEYS, bossDetails, type BossSection } from '../data/bossInfo'
import { BOSS_MODEL_FIX, bossModelUrl } from '../data/bossModels'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { useLocale } from '../i18n/LocaleProvider'
import { useReducedMotion } from '../theme/gear/useGearActive'
import type { BossViewerHandle } from '../gallery/bossViewer3d'
import { BOSS_SWAY_HINTS } from '../gallery/bossSwayHints'
import { BossInfoPanel } from '../gallery/BossInfoPanel'
import { isMobileLayout } from '../platform'

const SPIN_STORAGE_KEY = 'tarkov-gallery-spin-v1'
const TAB_STORAGE_KEY = 'tarkov-gallery-tab-v1'

const withModel = new Map(allBossFigures().filter((figure) => bossModelUrl(figure.key)).map((figure) => [figure.key, figure]))
/** Only bosses that have both a still and a 3D model; a key without a model yet is simply skipped. */
const SECTIONS: Record<BossSection, BossFigure[]> = {
  main: GALLERY_BOSS_KEYS.main.flatMap((key) => withModel.get(key) ?? []),
  ancient: GALLERY_BOSS_KEYS.ancient.flatMap((key) => withModel.get(key) ?? []),
}

function readSpin() {
  try { return localStorage.getItem(SPIN_STORAGE_KEY) === '1' } catch { return false }
}
/** The section shown last (a «Торговцы» tab saved by an older version opens the main bosses). */
function readTab(): BossSection {
  try { return localStorage.getItem(TAB_STORAGE_KEY) === 'ancient' ? 'ancient' : 'main' } catch { return 'main' }
}
const mapLine = (key: string) => bossMapIds(key).map((id) => uiText(MAP_DISPLAY_NAMES[id] ?? id)).join(' · ')

/**
 * «Боссы» (the «Галерея» until 12.10.2026, renamed by the owner): the owner's 3D models of the bosses, main and ancient.
 * The traders' figures are on the Traders page (the «Торговцы» tab here was removed by the owner, 12.10.2026). The grid
 * shows light pre-rendered stills; only the opened boss gets a live 3D viewer (three.js is imported on open, freed on close).
 */
export function GalleryPage() {
  const { locale } = useLocale()
  // «Открыть «Боссы»» of an announcement (src/events/ScourgeEventIntro.tsx) opens that boss at once.
  const asked = (useLocation().state as { boss?: string } | null)?.boss
  const askedSection = asked ? (Object.keys(SECTIONS) as BossSection[]).find((key) => SECTIONS[key].some((figure) => figure.key === asked)) : undefined
  const [section, setSection] = useState<BossSection>(() => askedSection ?? readTab())
  const [openKey, setOpenKey] = useState<string | null>(askedSection ? asked! : null)
  useEffect(() => { try { localStorage.setItem(TAB_STORAGE_KEY, section) } catch { /* per-viewer convenience only */ } }, [section])
  const figures = SECTIONS[section]

  return <div className="page gallery-page">
    <header className="page-header"><div>
      <div className="eyebrow">{uiText('3D модели')}</div>
      <h1 className="page-title">{uiText('Боссы')}</h1>
      <p className="page-subtitle">{uiText(isMobileLayout() ? 'Откройте карточку и вращайте модель пальцем; щипок — приблизить.' : 'Откройте карточку и вращайте модель мышью; колесо — приблизить.')}</p>
    </div></header>
    <div className="segmented-filter gallery-subtabs" role="group" aria-label={uiText('Боссы')}>
      {(['main', 'ancient'] as const).map((value) => <button key={value} type="button" className={section === value ? 'active' : ''} aria-pressed={section === value} onClick={() => setSection(value)}>
        {uiText(value === 'main' ? 'Основные' : 'Древние боссы')} <span className="gallery-count">{SECTIONS[value].length}</span>
      </button>)}
    </div>
    <div className="gallery-grid">
      {figures.map((figure) => {
        const info = bossDetails(figure.key)
        const maps = mapLine(figure.key)
        return <button type="button" key={figure.key} className="gallery-card" onClick={() => setOpenKey(figure.key)}>
          <span className="gallery-card-stage">
            <img src={figure.url} alt="" loading="lazy" decoding="async" />
            {info?.health ? <b className="gallery-card-hp">{info.health} HP</b> : null}
          </span>
          <span className="gallery-card-name">{figure.name[locale]}</span>
          {info && <span className="gallery-card-role">{info.role[locale]}</span>}
          {section === 'main' && <span className="gallery-card-maps">
            {maps || uiText('Вне карт')}
          </span>}
        </button>
      })}
    </div>
    {openKey && <BossViewerDialog
      bossKey={openKey}
      figures={figures}
      onClose={() => setOpenKey(null)}
      onStep={(step) => setOpenKey((current) => {
        const index = figures.findIndex((figure) => figure.key === current)
        return figures[(index + step + figures.length) % figures.length].key
      })}
    />}
  </div>
}

function BossViewerDialog({ bossKey, figures, onClose, onStep }: { bossKey: string; figures: BossFigure[]; onClose: () => void; onStep: (step: number) => void }) {
  const { locale } = useLocale()
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<BossViewerHandle | null>(null)
  const [ready, setReady] = useState(false)
  /** The boss whose model is on screen; until it is the one asked for, his still stands in for it. */
  const [shown, setShown] = useState<string | null>(null)
  const requested = useRef<string | null>(null)
  const [failed, setFailed] = useState(false)
  // Switching (even straight back to the boss on screen) shows the still at once, never the previous view for a frame.
  const [switchedTo, setSwitchedTo] = useState(bossKey)
  if (switchedTo !== bossKey) {
    setSwitchedTo(bossKey)
    setShown(null)
  }
  const [spin, setSpin] = useState(readSpin)
  const spinRef = useRef(spin)
  const figure = figures.find((entry) => entry.key === bossKey)
  const info = bossDetails(bossKey)

  // One viewer for the dialog's lifetime; switching bosses only swaps the model.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.focus({ preventScroll: true })
    let cancelled = false
    import('../gallery/bossViewer3d')
      .then(({ mountBossViewer }) => {
        if (cancelled) return
        handleRef.current = mountBossViewer(canvas, { reduced, onLoading: (busy) => {
          if (!busy) { setShown(requested.current); return }
          setFailed(false)
          setShown(null)
        }, onError: () => setFailed(true) })
        handleRef.current.setSpin(spinRef.current)
        setReady(true)
      })
      .catch(() => setFailed(true))
    return () => {
      cancelled = true
      handleRef.current?.dispose()
      handleRef.current = null
      setReady(false)
      setShown(null)
    }
  }, [reduced])

  useEffect(() => {
    const url = bossModelUrl(bossKey)
    if (!ready || !url) return
    requested.current = bossKey
    handleRef.current?.load(url, BOSS_MODEL_FIX[bossKey], BOSS_SWAY_HINTS[bossKey])
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

  const basedOn = info?.basedOn ? withModel.get(info.basedOn)?.name[locale] : undefined
  const loading = shown !== bossKey && !failed
  // The still stands exactly where the model will appear (the viewer's start view), so the swap is seamless.
  const frame = figure?.frame
  const stillStyle = frame ? { '--still-left': frame[0], '--still-top': frame[1], '--still-width': frame[2], '--still-height': frame[3] } as CSSProperties : undefined
  // Portalled to <body>: the page's entry animation would otherwise trap position: fixed inside it.
  return createPortal(<div className="gallery-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="gallery-viewer panel" role="dialog" aria-modal="true" aria-label={figure?.name[locale]}>
      <header className="gallery-viewer-head">
        <div>
          <div className="eyebrow">{info?.role[locale] ?? uiText('Боссы')}</div>
          <h2 className="gallery-viewer-title">{figure?.name[locale] ?? bossKey}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={17} /></button>
      </header>
      <div className="gallery-viewer-body">
        <div className="gallery-viewer-stage">
          {/* The still shows instantly and stays until the model is on screen. */}
          {figure && (loading || failed) && <img className={`gallery-viewer-still${frame ? ' has-frame' : ''}`} style={stillStyle} src={figure.url} alt="" />}
          <canvas ref={canvasRef} tabIndex={0} aria-label={uiText('3D модель: перетащите, чтобы повернуть')} className={loading || failed ? 'is-hidden' : ''} />
          {loading && !failed && <span className="gallery-viewer-status"><Loader2 size={14} className="spin" /> {uiText('Загрузка модели…')}</span>}
          {failed && <span className="gallery-viewer-status is-error">{uiText('Не удалось загрузить 3D модель')}</span>}
          <button type="button" className="gallery-viewer-step is-prev" onClick={() => onStep(-1)} aria-label={uiText('Предыдущий босс')} title={uiText('Предыдущий босс')}><ChevronLeft size={22} /></button>
          <button type="button" className="gallery-viewer-step is-next" onClick={() => onStep(1)} aria-label={uiText('Следующий босс')} title={uiText('Следующий босс')}><ChevronRight size={22} /></button>
        </div>
        {info && <BossInfoPanel bossKey={bossKey} basedOn={basedOn} />}
      </div>
      <footer className="gallery-viewer-foot">
        <span className="gallery-viewer-hint">{uiText(isMobileLayout() ? 'Проведите пальцем — повернуть · щипок — масштаб · двойное касание — сброс' : 'Перетащите — повернуть · колесо — масштаб · двойной клик — сброс')}</span>
        {!reduced && <div className="gallery-viewer-actions">
          <button type="button" className={`button ghost${spin ? ' is-on' : ''}`} aria-pressed={spin} onClick={() => setSpin((value) => !value)}><RotateCw size={14} /> {uiText('Автоповорот')}</button>
        </div>}
      </footer>
    </section>
  </div>, document.body)
}
