import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * A link with an anchor (/cabinet#subscription, /legal#refund) scrolls to that section once it is on the page: the
 * router does not, and the cabinet draws its sections only after the account loads, so the look is retried for 3 s.
 */
export function useHashScroll() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const id = decodeURIComponent(hash.slice(1))
    let tries = 0
    const timer = window.setInterval(() => {
      const target = document.getElementById(id)
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' })
        window.clearInterval(timer)
      } else if (++tries > 30) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
  }, [pathname, hash])
}
