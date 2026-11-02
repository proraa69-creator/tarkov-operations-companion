import { useEffect, useMemo, useState } from 'react'
import { adminKept } from './adminApi'
import { errorText } from './adminFormat'

export interface AdminAnswer<T> {
  /** The answer for `key`; until it comes, the one kept from the last time (adminKeep.ts); null without either. */
  data: T | null
  /** The answer for `key` (or for this `version`) has not come yet. */
  loading: boolean
  /** The last request for `key` failed; `data` still holds what was there. */
  error: string
  /** When `data` is the kept answer from the last time (ms), not this session's. */
  keptAt?: number
}

/**
 * One screen's data from the server (owner, 03.11.2026: «долго загружает»): shows the last kept answer at once, asks for
 * a fresh one when `key` or `version` change, keeps what it had when a request fails. An answer to an older `key` is not
 * shown under a newer one, except with `keepPrevious` (a list stays on screen while its new filter loads, its controls
 * with it). `key` null: nothing is asked.
 */
export function useAdminAnswer<T>(key: string | null, load: () => Promise<T>, version: number | string = 0, options: { keepPrevious?: boolean } = {}): AdminAnswer<T> {
  const [result, setResult] = useState<{ key: string; version: number | string; data?: T; error?: string } | null>(null)
  useEffect(() => {
    if (!key) return
    let active = true
    load().then(
      (data) => { if (active) setResult({ key, version, data }) },
      (reason: unknown) => {
        if (active) setResult((current) => ({ key, version, error: errorText(reason), ...(current?.key === key && current.data !== undefined ? { data: current.data } : {}) }))
      },
    )
    return () => { active = false }
  }, [key, load, version])
  const kept = useMemo(() => (key ? adminKept<T>(key) : null), [key])
  const own = key && result?.key === key ? result : null
  const data = own?.data ?? kept?.value ?? (options.keepPrevious ? result?.data : undefined) ?? null
  return {
    data,
    loading: Boolean(key) && (own === null || own.version !== version),
    error: own?.error ?? '',
    ...(own?.data === undefined && kept ? { keptAt: kept.at } : {}),
  }
}
