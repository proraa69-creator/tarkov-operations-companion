import { useEffect, useState } from 'react'

/**
 * «Раскачка» (owner, 23.11.2026: «Кнопка «Раскачка» у нас что-то делает или нет? Я просто не заметил разницы»): the weapon's
 * slow drift while aiming, as in the game — a breathing loop in front of the target, wider for an unhandy weapon. It is the whole
 * weapon that drifts: the shot goes where the swaying barrel points, and through a scope the view drifts with it (the reticle
 * stays in the middle, the target moves under it). The amplitude is an angle from the weapon's ergonomics, an estimate of ours.
 */
export function swayMrad(ergonomics: number | undefined) {
  const ergo = typeof ergonomics === 'number' && Number.isFinite(ergonomics) ? ergonomics : 50
  return Math.min(1.6, Math.max(0.25, 0.4 + (70 - ergo) * 0.02))
}

/** The drift at a moment (ms), centimetres at the target for an amplitude in centimetres: mostly up and down, a little aside. */
export function swayAt(timeMs: number, amplitudeCm: number) {
  const t = timeMs / 1000
  return {
    x: amplitudeCm * 0.55 * Math.sin((2 * Math.PI * t) / 3.7 + 0.8),
    y: amplitudeCm * (0.8 * Math.sin((2 * Math.PI * t) / 2.9) + 0.2 * Math.sin((2 * Math.PI * t) / 1.45 + 1.3)),
  }
}

/** The drift at this moment (a shot fired now goes where the barrel points now). */
export const swayNow = (amplitudeCm: number) => swayAt(performance.now(), amplitudeCm)

/** The time of the current animation frame while `on` (the drift is drawn from it), 0 otherwise. */
export function useSwayTime(on: boolean) {
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!on) return
    let frame = requestAnimationFrame(function tick(now) {
      setTime(now)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [on])
  return on ? time : 0
}
