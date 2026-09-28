import { uiText } from '../i18n/renderText'
import { useEffect, useRef, useState } from 'react'
import { wikiMapGuestScript, type WikiLandmark, type WikiQuestPin } from '../data/wikiMapPin'

interface Props {
  url: string
  searchTerms?: string[]
  pins?: WikiQuestPin[]
  landmarks?: WikiLandmark[]
}

interface WikiWebviewElement extends HTMLElement {
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>
}

export function WikiMapEmbed({ url, searchTerms = [], pins = [], landmarks = [] }: Props) {
  const viewRef = useRef<WikiWebviewElement | null>(null)
  const payload = { searchTerms, pins, landmarks }
  const payloadRef = useRef(payload)
  const [loaded, setLoaded] = useState(false)
  payloadRef.current = payload
  const payloadKey = JSON.stringify(payload)

  useEffect(() => {
    setLoaded(false)
    const view = viewRef.current
    if (!view) return
    const markReady = () => setLoaded(true)
    view.addEventListener('dom-ready', markReady)
    view.addEventListener('did-finish-load', markReady)
    view.addEventListener('did-stop-loading', markReady)
    return () => {
      view.removeEventListener('dom-ready', markReady)
      view.removeEventListener('did-finish-load', markReady)
      view.removeEventListener('did-stop-loading', markReady)
    }
  }, [url])

  useEffect(() => {
    if (!loaded) return
    const view = viewRef.current
    if (!view?.executeJavaScript) return
    let cancelled = false
    let attempt = 0
    const inject = () => {
      if (cancelled) return
      void view.executeJavaScript?.(wikiMapGuestScript(payloadRef.current), true).then((result) => {
        const ok = !payloadRef.current.pins.length || Boolean(result && typeof result === 'object' && 'ok' in result && (result as { ok?: boolean }).ok)
        attempt += 1
        if (!ok && attempt < 12 && !cancelled) window.setTimeout(inject, 400)
      }).catch(() => {
        attempt += 1
        if (attempt < 12 && !cancelled) window.setTimeout(inject, 400)
      })
    }
    const delay = window.setTimeout(inject, 500)
    return () => {
      cancelled = true
      window.clearTimeout(delay)
    }
  }, [loaded, payloadKey])

  return <div className="wiki-map-shell">
    {uiText(!loaded && <div className="wiki-map-loading">{uiText("Загрузка интерактивной карты Wiki…")}</div>)}
    <webview ref={viewRef} src={url} partition="persist:wiki-maps" className="wiki-map" />
  </div>
}
