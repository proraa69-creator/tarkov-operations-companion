import { flushSync } from 'react-dom'
import { UNSAFE_createHashHistory } from 'react-router-dom'
import { prefersReducedMotion } from '../shared/motion'

type HashHistory = ReturnType<typeof UNSAFE_createHashHistory>
type Listener = Parameters<HashHistory['listen']>[0]
type StartViewTransition = (update: () => void) => { finished: Promise<void> }

/**
 * The router's history (main.tsx, with `useTransitions={false}` so the new page renders synchronously): a change of
 * page — a link, a button, back or forward — runs inside a View Transition and the old page crossfades into the new
 * one (owner, 12.10.2026: «сделай нам так же плавно все приложение», the page switch of the reference video). Changes
 * within one page (?quest=…, a selected item) are not animated. Without View Transitions or with reduced motion the
 * page simply changes.
 */
export function createPageTransitionHistory(
  history: HashHistory = UNSAFE_createHashHistory({ v5Compat: true }),
  doc: Document = document,
): HashHistory {
  let shownPath = history.location.pathname
  const listen = (listener: Listener) => history.listen((update) => {
    const changesPage = update.location.pathname !== shownPath
    shownPath = update.location.pathname
    const start = (doc as Document & { startViewTransition?: StartViewTransition }).startViewTransition
    if (!changesPage || typeof start !== 'function' || prefersReducedMotion()) {
      listener(update)
      return
    }
    start.call(doc, () => flushSync(() => listener(update))).finished.catch(() => { /* skipped by a newer change */ })
  })
  // The other members (location, action, push, createHref…) are the history's own getters and methods.
  return Object.create(history, { listen: { value: listen } }) as HashHistory
}

/** Pages crossfade (src/styles/global.css): their own fade-in on mount would play twice. */
export function markViewTransitions(doc: Document = document) {
  if (typeof (doc as Document & { startViewTransition?: unknown }).startViewTransition === 'function') doc.documentElement.dataset.viewTransitions = ''
}
