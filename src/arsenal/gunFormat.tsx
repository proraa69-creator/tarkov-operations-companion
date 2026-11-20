/* eslint-disable react-refresh/only-export-components */
import type { UnlockHint } from './buildStats'
import { useMemo, useState } from 'react'
import { Crosshair } from 'lucide-react'
import { useOptionalTarkovData } from '../data/DataProvider'

const QUEST_ID = /^[0-9a-f]{24}$/

/**
 * A quest's name by its id from the game data: the trading data names some quests by their id alone (owner, 20.11.2026: the shopping
 * list said «квест «67a097379f2068e746…»»).
 */
export function useQuestNames(): (id: string) => string | undefined {
  const quests = useOptionalTarkovData()?.data.quests
  return useMemo(() => {
    const names = new Map((quests ?? []).map((quest) => [quest.id, quest.name]))
    return (id: string) => names.get(id)
  }, [quests])
}

/** What opens a part, after the lock: «Механик 3», «квест «Оружейник»», «барахолка с 30 ур.»; a quest known only by its id — «квест». */
export const unlockLabel = (hint: UnlockHint, locale: string, questName?: (id: string) => string | undefined) => {
  if (hint.kind === 'trader') return `${hint.vendorName} ${hint.level}`
  if (hint.kind === 'task') {
    const name = questName?.(hint.taskId) ?? (QUEST_ID.test(hint.task) ? '' : hint.task)
    if (!name) return locale === 'en' ? 'quest' : 'квест'
    return locale === 'en' ? `quest «${name}»` : `квест «${name}»`
  }
  return locale === 'en' ? `flea from level ${hint.level}` : `барахолка с ${hint.level} ур.`
}

export const formatRub = (value: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} ₽`

/** +5 / −3 (true minus sign). */
export const signed = (value: number, digits = 0) => {
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(digits)}`
}

/** Fraction → «−5 %». */
/** With the tenths a game value has (ergonomics +0.5, not «+1» — owner, 18.10.2026: «у модулей неверные показатели»). */
export const signedExact = (value: number) => signed(value, Math.round(Math.abs(value) * 10) % 10 ? 1 : 0)
export const formatModifier = (fraction: number) => `${signed(fraction * 100, Math.abs(fraction * 100) % 1 ? 1 : 0)} %`

/** Caliber556x45NATO → 5.56x45 NATO, Caliber127x55 → 12.7x55, Caliber1143x23ACP → 11.43x23 ACP. */
export function prettyCaliber(value: string) {
  const withDot = value.replace(/^Caliber/, '').replace(/^(\d+)x/, (_, digits: string) => {
    if (digits.length < 3) return `${digits}x`
    const whole = digits.length >= 4 || digits.startsWith('12') ? 2 : 1
    return `${digits.slice(0, whole)}.${digits.slice(whole)}x`
  })
  return withDot.replace(/([a-z\d])([A-Z]{2,})$/, '$1 $2') || '—'
}

/** An item icon that degrades to a glyph when tarkov.dev assets are unreachable. */
/**
 * A weapon's picture: always the whole gun (owner, 06.11.2026: «Должно быть всегда цельное оружие»). The base item's own icon
 * is a bare part, a receiver for an M4A1: only a weapon with no default build falls back to it.
 */
export const weaponIcon = (weapon: { iconLink?: string; defaultPreset?: { iconLink?: string; image512pxLink?: string } } | undefined) => weapon?.defaultPreset?.iconLink ?? weapon?.defaultPreset?.image512pxLink ?? weapon?.iconLink

export function PartIcon({ src, size = 'small' }: { src?: string; size?: 'small' | 'large' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className={`gb-icon gb-icon-${size} is-empty`} aria-hidden="true"><Crosshair size={size === 'large' ? 34 : 14} /></span>
  return <img className={`gb-icon gb-icon-${size}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}
