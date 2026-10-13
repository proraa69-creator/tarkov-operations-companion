import { useLayoutEffect, useRef } from 'react'
import { Megaphone } from 'lucide-react'
import { useAnnouncement } from './announcement'
import './announcement.css'

/**
 * The owner's notice at the top of the app («Ведутся технические работы…»), on every page (`shell`: under the top bar,
 * the pages move down by its height) and on the locked screens (`page`), until the owner turns it off. Not closable: it
 * stays while it is true. The owner's own words, shown as written.
 */
export function AnnouncementBanner({ placement = 'shell' }: { placement?: 'shell' | 'page' }) {
  const announcement = useAnnouncement()
  const banner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = banner.current
    if (placement !== 'shell' || !element) return
    const root = document.documentElement
    const measure = () => root.style.setProperty('--announcement-height', `${element.offsetHeight}px`)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.removeProperty('--announcement-height')
    }
  }, [announcement, placement])
  if (!announcement) return null
  return (
    <div ref={banner} className={`announcement-banner is-${placement}`} role="status" aria-live="polite">
      <Megaphone size={15} aria-hidden="true" />
      <span>{announcement.text}</span>
    </div>
  )
}
