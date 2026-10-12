import { describe, expect, it, vi } from 'vitest'
import { UNSAFE_createHashHistory } from 'react-router-dom'
import { createPageTransitionHistory, markViewTransitions } from './pageTransitionHistory'

/** A document whose View Transition runs the update at once and remembers that it was asked for. */
function fakeDocument(supported = true) {
  const started: string[] = []
  const doc = document.implementation.createHTMLDocument('test')
  if (supported) {
    Object.assign(doc, {
      startViewTransition: (update: () => void) => {
        started.push('transition')
        update()
        return { finished: Promise.resolve() }
      },
    })
  }
  return { doc, started }
}

describe('page changes crossfade (owner, 12.10.2026: «сделай нам так же плавно все приложение»)', () => {
  it('runs a change of page inside a View Transition, but not a change within the page', () => {
    window.location.hash = '#/'
    const { doc, started } = fakeDocument()
    const history = createPageTransitionHistory(UNSAFE_createHashHistory({ v5Compat: true }), doc)
    const seen: string[] = []
    const stop = history.listen(({ location }) => seen.push(location.pathname + location.search))
    history.push('/traders')
    expect(started).toHaveLength(1)
    history.push('/traders?trader=prapor')
    expect(started).toHaveLength(1)
    history.push('/quests')
    expect(started).toHaveLength(2)
    expect(seen).toEqual(['/traders', '/traders?trader=prapor', '/quests'])
    // the history's own members still work through the wrapper
    expect(history.location.pathname).toBe('/quests')
    expect(history.createHref({ pathname: '/maps' })).toBe('#/maps')
    stop()
  })

  it('changes the page directly without View Transitions or with reduced motion', () => {
    window.location.hash = '#/'
    const { doc } = fakeDocument(false)
    const history = createPageTransitionHistory(UNSAFE_createHashHistory({ v5Compat: true }), doc)
    const listener = vi.fn()
    const stop = history.listen(listener)
    history.push('/maps')
    expect(listener).toHaveBeenCalledTimes(1)
    stop()

    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    const animated = fakeDocument()
    const second = createPageTransitionHistory(UNSAFE_createHashHistory({ v5Compat: true }), animated.doc)
    const stopSecond = second.listen(() => {})
    second.push('/flea')
    expect(animated.started).toHaveLength(0)
    stopSecond()
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('marks the document so the pages do not fade in a second time', () => {
    const { doc } = fakeDocument()
    markViewTransitions(doc)
    expect(doc.documentElement.dataset.viewTransitions).toBe('')
    const plain = fakeDocument(false).doc
    markViewTransitions(plain)
    expect(plain.documentElement.dataset.viewTransitions).toBeUndefined()
  })
})
