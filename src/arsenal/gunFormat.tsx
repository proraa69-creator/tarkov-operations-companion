/* eslint-disable react-refresh/only-export-components */
import { useState } from 'react'
import { Crosshair } from 'lucide-react'

export const formatRub = (value: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(value))} ₽`

/** +5 / −3 (true minus sign). */
export const signed = (value: number, digits = 0) => {
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(digits)}`
}

/** Fraction → «−5 %». */
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
export function PartIcon({ src, size = 'small' }: { src?: string; size?: 'small' | 'large' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className={`gb-icon gb-icon-${size} is-empty`} aria-hidden="true"><Crosshair size={size === 'large' ? 34 : 14} /></span>
  return <img className={`gb-icon gb-icon-${size}`} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}
