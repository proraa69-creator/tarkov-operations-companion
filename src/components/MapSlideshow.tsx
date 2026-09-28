import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useState } from 'react'
import { showcaseOrder } from '../data/mapShowcase'

interface MapSlideshowProps {
  active: boolean
  firstMapId?: string
  intervalMs?: number
}

export function MapSlideshow({ active, firstMapId, intervalMs = 2000 }: MapSlideshowProps) {
  const shots = useMemo(() => showcaseOrder(firstMapId), [firstMapId])
  const [{ index, previous }, setSlide] = useState<{ index: number; previous: number | null }>({ index: 0, previous: null })
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    setSlide({ index: 0, previous: null })
  }, [shots])

  useEffect(() => {
    if (!active || reducedMotion || shots.length < 2) return
    const timer = globalThis.setInterval(() => {
      setSlide((current) => ({ index: (current.index + 1) % shots.length, previous: current.index }))
    }, intervalMs)
    return () => globalThis.clearInterval(timer)
  }, [active, reducedMotion, shots.length, intervalMs])

  useEffect(() => {
    if (!active || typeof Image === 'undefined') return
    const next = shots[(index + 1) % shots.length]
    if (!next) return
    const preload = new Image()
    preload.referrerPolicy = 'no-referrer'
    preload.src = next.url
  }, [active, index, shots])

  if (!active || !shots.length) return null
  const visible = previous != null && previous !== index ? [previous, index] : [index]
  return (
    <div className="map-slideshow" aria-hidden="true">
      {uiText(visible.map((slide) => (
        // Fandom's CDN serves a placeholder when a foreign Referer is sent.
        <img
          key={`${slide}:${shots[slide].url}`}
          className={`map-slide${slide === index ? ' is-current' : ''}`}
          src={shots[slide].url}
          alt={uiText("")}
          referrerPolicy="no-referrer"
          decoding="async"
        />
      )))}
      <div className="map-slideshow-shade" />
    </div>
  )
}

function usePrefersReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const onChange = () => setReduced(media.matches)
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [])
  return reduced
}
