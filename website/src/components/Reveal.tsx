import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { prefersReducedMotion } from '../hooks/motion'

/**
 * Reveal-on-scroll: children fade/slide in the first time they enter the viewport.
 * Without IntersectionObserver, or with reduced motion, content is simply shown.
 */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode, delay?: number, className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined' || prefersReducedMotion())

  useEffect(() => {
    const node = ref.current
    if (shown || !node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShown(true)
        observer.disconnect()
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [shown])

  const style = delay ? ({ '--reveal-delay': `${delay}ms` } as CSSProperties) : undefined
  return <div ref={ref} className={`reveal${shown ? ' is-visible' : ''}${className ? ` ${className}` : ''}`} style={style}>{children}</div>
}
