import { useCallback, useEffect, useRef, useState } from 'react'
import { useMobileLayout } from '../platform'

type LockableOrientation = ScreenOrientation & { lock?: (orientation: string) => Promise<void>; unlock?: () => void }

/**
 * The range's full screen, on a phone only (owner, 24.11.2026: «Версия для телефона только будет на полный экран, на компьютере не
 * будет… И перевод в горизонтальное положение при полноэкранном режиме»): the scope over the whole screen, the browser's own full
 * screen where it is given, the screen locked to landscape where the phone allows it; where it does not and the phone is held
 * upright, the picture is turned a quarter instead (`turned`).
 */
const touchFirst = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches)

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
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) } catch { /* the page's own full screen stays */ }
    try {
      await (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape')
      landscapeLocked.current = true
    } catch { landscapeLocked.current = false }
    setTurned(!landscapeLocked.current && upright())
  }, [])
  const closeFull = useCallback(() => {
    setFull(false)
    setTurned(false)
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
  useEffect(() => () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }, [])
  return { phone, full, turned, openFull, closeFull }
}
