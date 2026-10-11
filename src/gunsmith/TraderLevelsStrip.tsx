import { useEffect, useRef, useState } from 'react'
import { Crown } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { TraderBadge } from './ShoppingTable'
import { loyaltyNumeral, MAX_TRADER_LEVEL, type TraderLevelInfo } from './traderLevels'

/**
 * «Ваши уровни торговцев» for this mode: the portraits like the game's trader strip, each with the loyalty level the app
 * uses. A click sets the real level (I, II, III, crown) or goes back to the estimate from the tasks.
 */
export function TraderLevelsStrip({ infos, mode, onSet }: { infos: TraderLevelInfo[]; mode: RaidMode; onSet: (key: string, level: number | null) => void }) {
  const { locale } = useLocale()
  const [open, setOpen] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!listRef.current?.contains(event.target as Node)) setOpen(null) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape) }
  }, [open])
  if (!infos.length) return null
  const modeName = mode === 'seasonal' ? (locale === 'en' ? 'Season' : 'Сезон') : mode.toUpperCase()
  return <section className="gs-levels" aria-label={uiText('Ваши уровни торговцев')}>
    <div className="gs-levels-head">
      <strong>{uiText('Ваши уровни торговцев')} · {modeName}</strong>
      <small>{uiText('Игра не пишет уровень лояльности в логи: он оценён по взятым заданиям и уровню персонажа. Нажмите на торговца, чтобы указать свой.')}</small>
    </div>
    <ul className="gs-levels-list" ref={listRef}>
      {infos.map((info) => <li key={info.key} className={`gs-level${open === info.key ? ' is-open' : ''}`}>
        <button type="button" className="gs-level-button" aria-haspopup="true" aria-expanded={open === info.key}
          title={`${uiText(info.trader.name)} · ${locale === 'en' ? `loyalty ${info.level}` : `уровень лояльности ${info.level}`}`} onClick={() => setOpen((current) => current === info.key ? null : info.key)}>
          <TraderBadge trader={info.trader} name={info.trader.name} level={info.level} />
          <span className="gs-level-name">{uiText(info.trader.name)}</span>
          <span className={`gs-level-note${info.manual ? ' is-own' : ''}`}>{uiText(info.manual ? 'свой' : 'оценка')}</span>
        </button>
        {open === info.key && <div className="gs-level-menu" role="menu">
          {Array.from({ length: MAX_TRADER_LEVEL }, (_, index) => index + 1).map((level) => <button key={level} type="button" role="menuitemradio" aria-checked={info.level === level}
            className={info.level === level ? 'is-current' : ''} aria-label={`LL${level}`} onClick={() => { onSet(info.key, level); setOpen(null) }}>
            {level >= MAX_TRADER_LEVEL ? <Crown size={12} strokeWidth={2.5} aria-hidden="true" /> : loyaltyNumeral(level)}
          </button>)}
          {info.manual && <button type="button" role="menuitem" className="gs-level-auto" onClick={() => { onSet(info.key, null); setOpen(null) }}>{uiText('по заданиям')}</button>}
        </div>}
      </li>)}
    </ul>
  </section>
}
