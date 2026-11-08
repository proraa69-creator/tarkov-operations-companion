import { normalizeAdMark, type AdMark } from '../../src/shared/adSources'
import { api } from './api'
import { saveAdMark } from './storage'

/**
 * «Реклама» (src/shared/adSources.ts): the site opened from an ad's link (?utm_source=reddit&utm_campaign=…) keeps the
 * label for the registration (storage.ts loadAdMark) and tells the server about the visit once per tab session; the
 * server counts it once a day per visitor. An unknown platform is ignored, so are server errors.
 */
export function captureAdVisit(search = typeof window === 'undefined' ? '' : window.location.search, send: (mark: AdMark) => Promise<unknown> = (mark) => api.adVisit(mark.source, mark.campaign)) {
  const params = new URLSearchParams(search)
  const mark = normalizeAdMark(params.get('utm_source'), params.get('utm_campaign'))
  if (!mark) return undefined
  saveAdMark(mark)
  const seenKey = `toc.visit.ad.${mark.source}`
  let seen = false
  try { seen = window.sessionStorage.getItem(seenKey) === '1' } catch { /* storage unavailable */ }
  if (!seen) {
    void send(mark).then(
      () => { try { window.sessionStorage.setItem(seenKey, '1') } catch { /* storage unavailable */ } },
      () => undefined,
    )
  }
  return mark
}
