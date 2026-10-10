import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Crosshair, ExternalLink, HeartPulse, ListOrdered, Map as MapIcon, Package, Swords } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { allBossFigures, bossMapIds, BOSS_NAMES } from '../data/bossFigures'
import { bossDetails } from '../data/bossInfo'
import { bossTactics, figureKeyOf } from '../data/bossTactics'
import { MAP_DISPLAY_NAMES } from '../data/mapIds'
import './bossTactics.css'

/** Names of bosses without a figure of their own. */
const EXTRA_NAMES: Record<string, { ru: string; en: string }> = {
  'cultist-priest': { ru: 'Жрец культа', en: 'Cultist Priest' },
  'the-wedge': { ru: 'Клин', en: 'The Wedge' },
  'shadow-of-tagilla': { ru: 'Тень Тагиллы', en: 'Shadow of Tagilla' },
}

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/**
 * «Тактика боя» (owner, 10.10.2026): how one boss fights, where to hit him and a plan for the fight. Not in the menu —
 * opened only from the boss's «Тактика боя» button (Gallery, the raid card); «Назад» returns to where it was opened.
 */
export function BossTacticsPage() {
  const { key = '' } = useParams()
  const navigate = useNavigate()
  const { locale } = useLocale()
  const tactics = bossTactics(key)
  const figureKey = figureKeyOf(key)
  const figure = allBossFigures().find((entry) => entry.key === figureKey)
  const names = BOSS_NAMES[figureKey] ?? EXTRA_NAMES[key]
  const name = names ? (locale === 'en' ? names.en : names.ru) : key
  const maps = bossMapIds(figureKey)
  const health = bossDetails(figureKey)?.health
  // Back to the page the button was on; a page opened without history goes to the Gallery.
  const back = () => { if (window.history.state?.idx > 0) navigate(-1); else navigate('/gallery') }

  if (!tactics) {
    return <div className="page boss-tactics-page">
      <button type="button" className="button boss-tactics-back" onClick={back}><ArrowLeft size={16} />{uiText('Назад')}</button>
      <div className="panel empty-state"><div><Swords size={28} /><h2>{uiText('Тактики для этого босса пока нет')}</h2></div></div>
    </div>
  }

  return <div className="page boss-tactics-page">
    <button type="button" className="button boss-tactics-back" onClick={back}><ArrowLeft size={16} />{uiText('Назад')}</button>

    <header className="panel boss-tactics-hero">
      {figure && <img className="boss-tactics-figure" src={figure.url} alt="" draggable={false} />}
      <div className="boss-tactics-hero-copy">
        <div className="eyebrow"><Swords size={13} /> {uiText('Тактика боя')}</div>
        <h1 className="page-title">{uiText(name)}</h1>
        <p className="boss-tactics-summary">{tactics.summary}</p>
        <div className="boss-tactics-facts">
          {maps.map((id) => <span key={id} className="boss-tactics-chip"><MapIcon size={12} />{uiText(MAP_DISPLAY_NAMES[id] ?? id)}</span>)}
          {health ? <span className="boss-tactics-chip is-health"><HeartPulse size={12} />{health} HP</span> : null}
        </div>
      </div>
    </header>

    <div className="boss-tactics-grid">
      <section className="panel boss-tactics-block">
        <h2><Swords size={16} />{uiText('Как действует')}</h2>
        <ul>{tactics.behavior.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <section className="panel boss-tactics-block is-weak">
        <h2><Crosshair size={16} />{uiText('Слабые места')}</h2>
        <ul>{tactics.weakPoints.map((line) => <li key={line}>{line}</li>)}</ul>
      </section>
      <section className="panel boss-tactics-block is-plan">
        <h2><ListOrdered size={16} />{uiText('План боя')}</h2>
        <ol>{tactics.tactics.map((line) => <li key={line}>{line}</li>)}</ol>
      </section>
      <section className="panel boss-tactics-block is-danger">
        <h2><AlertTriangle size={16} />{uiText('Чем опасен')}</h2>
        <ul>{tactics.dangers.map((line) => <li key={line}>{line}</li>)}</ul>
        {tactics.loot && <p className="boss-tactics-loot"><Package size={14} /><span><b>{uiText('Лут')}:</b> {tactics.loot}</span></p>}
      </section>
    </div>

    <details className="boss-tactics-sources">
      <summary>{uiText('Источники')} · {tactics.sources.length}</summary>
      <p className="dim">{uiText('Собрано из гайдов и вики игроков; поведение боссов меняется с патчами, шансы появления разные в PvP, PvE и «Сезоне».')}</p>
      <ul>{tactics.sources.map((url) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />{host(url)}</a></li>)}</ul>
    </details>
  </div>
}
