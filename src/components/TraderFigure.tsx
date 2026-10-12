import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Trader } from '../domain/types'
import { TRADER_MODEL_FIX, traderModelKey, traderModelUrl } from '../data/traderModels'
import type { BossViewerHandle } from '../gallery/bossViewer3d'
import { TRADER_SWAY_HINTS } from '../gallery/traderSwayHints'
import { uiText } from '../i18n/renderText'
import { isMobileLayout } from '../platform'
import { useReducedMotion } from '../theme/gear/useGearActive'
import './traderFigure.css'

/**
 * The selected trader's 3D figure on the Traders page, next to the trader cards (owner, 11.10.2026: «добавь 3д модели
 * всех торговцев… туда, где я скину скриншот, а блок с квестами перенеси ниже, при включении каждого торговца меняется
 * фигурка»). The Gallery's viewer (three.js, imported only here and only when the trader has a model): drag to turn,
 * wheel or pinch to zoom, double click to reset; open coats and jackets move with the turn (traderSwayHints.ts).
 * Switching keeps the previous figure on screen until the next one is drawn, so nothing blinks.
 */
export function TraderFigure({ trader }: { trader: Trader }) {
  const key = traderModelKey(trader)
  const url = key ? traderModelUrl(key) : undefined
  if (!key || !url) return <section className="panel trader-figure is-empty" aria-label={uiText(trader.name)}>
    <div className="trader-figure-portrait" style={{ borderColor: trader.accent }}>
      {trader.imageUrl ? <img src={trader.imageUrl} alt="" /> : <span>{trader.name[0]}</span>}
    </div>
    <strong>{uiText(trader.name)}</strong>
    <p className="muted">{uiText('3D модель этого торговца скоро появится.')}</p>
  </section>
  return <TraderStage modelKey={key} url={url} name={trader.name} />
}

function TraderStage({ modelKey, url, name }: { modelKey: string; url: string; name: string }) {
  const reduced = useReducedMotion()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handleRef = useRef<BossViewerHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    import('../gallery/bossViewer3d')
      .then(({ mountBossViewer }) => {
        if (cancelled) return
        handleRef.current = mountBossViewer(canvas, { reduced, onLoading: (busy) => { setLoading(busy); if (busy) setFailed(false) }, onError: () => setFailed(true) })
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
    if (ready) handleRef.current?.load(url, TRADER_MODEL_FIX, TRADER_SWAY_HINTS[modelKey])
  }, [modelKey, ready, url])

  return <section className="panel trader-figure" aria-label={uiText(name)}>
    <div className="trader-figure-stage">
      <canvas ref={canvasRef} tabIndex={0} aria-label={uiText('3D модель: перетащите, чтобы повернуть')} className={failed ? 'is-hidden' : ''} />
      {loading && !failed && <span className="trader-figure-status"><Loader2 size={14} className="spin" /> {uiText('Загрузка модели…')}</span>}
      {failed && <span className="trader-figure-status is-error">{uiText('Не удалось загрузить 3D модель')}</span>}
    </div>
    <div className="trader-figure-foot">
      <strong>{uiText(name)}</strong>
      <span>{uiText(isMobileLayout() ? 'Проведите пальцем — повернуть · двойное касание — сброс' : 'Перетащите — повернуть · двойной клик — сброс')}</span>
    </div>
  </section>
}
