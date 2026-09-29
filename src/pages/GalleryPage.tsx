import { uiText } from '../i18n/renderText'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Loader2, RotateCw, Store, X } from 'lucide-react'
import { allBossFigures, bossMapIds, type BossFigure } from '../data/bossFigures'
import { GALLERY_BOSS_KEYS, bossDetails, type BossSection } from '../data/bossInfo'
import { BOSS_MODEL_FIX, bossModelUrl } from '../data/bossModels'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import { useLocale } from '../i18n/LocaleProvider'
import { useReducedMotion } from '../theme/gear/useGearActive'
import type { BossViewerHandle } from '../gallery/bossViewer3d'
import { isMobileLayout } from '../platform'

const SPIN_STORAGE_KEY = 'tarkov-gallery-spin-v1'
const TAB_STORAGE_KEY = 'tarkov-gallery-tab-v1'
type GalleryTab = 'main' | 'ancient' | 'traders'

const withModel = new Map(allBossFigures().filter((figure) => bossModelUrl(figure.key)).map((figure) => [figure.key, figure]))
/** Only bosses that have both a still and a 3D model; a key without a model yet is simply skipped. */
const SECTIONS: Record<BossSection, BossFigure[]> = {
  main: GALLERY_BOSS_KEYS.main.flatMap((key) => withModel.get(key) ?? []),
  ancient: GALLERY_BOSS_KEYS.ancient.flatMap((key) => withModel.get(key) ?? []),
}

function readSpin() {
  try { return localStorage.getItem(SPIN_STORAGE_KEY) === '1' } catch { return false }
}
function readTab(): GalleryTab {
  try {
    const value = localStorage.getItem(TAB_STORAGE_KEY)
    return value === 'ancient' || value === 'traders' ? value : 'main'
  } catch { return 'main' }
}
const mapLine = (key: string) => bossMapIds(key).map((id) => uiText(MAP_DISPLAY_NAMES[id] ?? id)).join(' · ')

/**
 * «Галерея»: the owner's 3D models — bosses (main and ancient) and, later, traders. The grid shows light
 * pre-rendered stills; only the opened boss gets a live 3D viewer (three.js is imported on open, freed on close).
 */
export function GalleryPage() {
  const { locale } = useLocale()
  const [tab, setTab] = useState<GalleryTab>(readTab)
  const [openKey, setOpenKey] = useState<string | null>(null)
  useEffect(() => { try { localStorage.setItem(TAB_STORAGE_KEY, tab) } catch { /* per-viewer convenience only */ } }, [tab])
  const section: BossSection | null = tab === 'traders' ? null : tab
  const figures = section ? SECTIONS[section] : []

  return <div className="page gallery-page">
    <header className="page-header"><div>
      <div className="eyebrow">{uiText('3D модели')}</div>
      <h1 className="page-title">{uiText('Галерея')}</h1>
      <p className="page-subtitle">{uiText(isMobileLayout() ? 'Откройте карточку и вращайте модель пальцем; щипок — приблизить.' : 'Откройте карточку и вращайте модель мышью; колесо — приблизить.')}</p>
    </div></header>
    <nav className="gallery-tabs" aria-label={uiText('Разделы галереи')}>
      <button type="button" className={section ? 'is-active' : ''} aria-current={section ? 'page' : undefined} onClick={() => setTab('main')}>{uiText('Боссы')}</button>
      <button type="button" className={tab === 'traders' ? 'is-active' : ''} aria-current={tab === 'traders' ? 'page' : undefined} onClick={() => setTab('traders')}>{uiText('Торговцы')}</button>
    </nav>
    {section && <div className="segmented-filter gallery-subtabs" role="group" aria-label={uiText('Боссы')}>
      {(['main', 'ancient'] as const).map((value) => <button key={value} type="button" className={section === value ? 'active' : ''} aria-pressed={section === value} onClick={() => setTab(value)}>
        {uiText(value === 'main' ? 'Основные' : 'Древние боссы')} <span className="gallery-count">{SECTIONS[value].length}</span>
      </button>)}
    </div>}
    {section ? <div className="gallery-grid">
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
    </div> : <div className="panel empty-state gallery-empty" role="status"><div>
      <Store size={30} />
      <h2>{uiText('Модели торговцев скоро появятся')}</h2>
      <p>{uiText('Здесь будут 3D модели торговцев Таркова. Пока загляните в раздел «Боссы».')}</p>
      <button type="button" className="button ghost" onClick={() => setTab('main')}>{uiText('К боссам')}</button>
    </div></div>}
    {openKey && section && <BossViewerDialog
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
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
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

  const maps = mapLine(bossKey)
  const basedOn = info?.basedOn ? withModel.get(info.basedOn)?.name[locale] : undefined
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
          {figure && (loading || failed) && <img className="gallery-viewer-still" src={figure.url} alt="" />}
          <canvas ref={canvasRef} tabIndex={0} aria-label={uiText('3D модель: перетащите, чтобы повернуть')} className={loading || failed ? 'is-hidden' : ''} />
          {loading && !failed && <span className="gallery-viewer-status"><Loader2 size={14} className="spin" /> {uiText('Загрузка модели…')}</span>}
          {failed && <span className="gallery-viewer-status is-error">{uiText('Не удалось загрузить 3D модель')}</span>}
          <button type="button" className="gallery-viewer-step is-prev" onClick={() => onStep(-1)} aria-label={uiText('Предыдущий босс')} title={uiText('Предыдущий босс')}><ChevronLeft size={22} /></button>
          <button type="button" className="gallery-viewer-step is-next" onClick={() => onStep(1)} aria-label={uiText('Следующий босс')} title={uiText('Следующий босс')}><ChevronRight size={22} /></button>
        </div>
        {info && <aside className="gallery-viewer-info" aria-label={uiText('Описание')}>
          <p className="gallery-info-about">{info.about[locale]}</p>
          <dl className="gallery-info-facts">
            {maps && <><dt>{uiText('Карты')}</dt><dd>{maps}</dd></>}
            {info.health ? <><dt>{uiText('Здоровье')}</dt><dd className="gallery-info-hp">{info.health} HP</dd></> : null}
            {info.weapons && <><dt>{uiText('Вооружение')}</dt><dd>{info.weapons[locale]}</dd></>}
            {info.loot && <><dt>{uiText('Ценный лут')}</dt><dd>{info.loot[locale]}</dd></>}
            {basedOn && <><dt>{uiText('По мотивам')}</dt><dd>{basedOn}</dd></>}
          </dl>
        </aside>}
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
