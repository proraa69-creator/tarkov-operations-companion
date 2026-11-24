import { useCallback, useEffect, useRef, useState } from 'react'
import { useMobileLayout } from '../platform'

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void>; unlock?: () => void }

/**
 * The range's full screen, on a phone only (owner, 24.11.2026: «Версия для телефона только будет на полный экран, на компьютере не
 * будет… И перевод в горизонтальное положение при полноэкранном режиме»): the scope over the whole screen, the screen locked to
 * landscape where the phone allows it; where it does not and the phone is held upright, the picture is turned a quarter instead
 * (`turned`).
 *
 * The browser's own full screen only off iOS (owner, 24.11.2026: «При выходе из полноэкранного режима стрельбы, ломается страница
 * полигона. Сужается и кнопки выходят из рамок»): the iPhone app's web view shows an element's full screen in a window of its own,
 * and back from it the page kept the screen edges of that window (turned on its side: no room under the clock, wide margins left
 * and right). The page's own full screen covers the app all the same.
 */
const touchFirst = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)
const appleTouch = () => typeof navigator !== 'undefined'
  && (/iP(hone|ad|od)/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
/** On <html> while the full screen is open: the page under it holds still. */
export const FULL_OPEN_CLASS = 'range-full-open'

export function useRangeFullScreen() {
  // the phone layout, or a touch screen turned on its side (wider than the phone layout's breakpoint)
  const phone = useMobileLayout() || touchFirst()
  const [full, setFull] = useState(false)
  const [turned, setTurned] = useState(false)
  const landscapeLocked = useRef(false)
  const upright = () => window.innerHeight > window.innerWidth
  const openFull = useCallback(async () => {
    setFull(true)
    setTurned(upright())
    document.documentElement.classList.add(FULL_OPEN_CLASS)
    if (!appleTouch()) try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) } catch { /* the page's own full screen stays */ }
    try {
      await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape')
      landscapeLocked.current = true
    } catch { landscapeLocked.current = false }
    setTurned(!landscapeLocked.current && upright())
  }, [])
  const closeFull = useCallback(() => {
    setFull(false)
    setTurned(false)
    document.documentElement.classList.remove(FULL_OPEN_CLASS)
    if (landscapeLocked.current) try { (screen.orientation as LockableOrientation | undefined)?.unlock?.() } catch { /* nothing to undo */ }
    landscapeLocked.current = false
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])
  useEffect(() => {
    if (!full) return
    // the phone turned by hand, or the lock taking effect late: turned only while it is still upright
    const onResize = () => setTurned(!landscapeLocked.current && upright())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [full])
  // leaving the page ends it
  useEffect(() => () => {
    document.documentElement.classList.remove(FULL_OPEN_CLASS)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])
  return { phone, full, turned, openFull, closeFull }
}
