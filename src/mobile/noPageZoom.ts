/**
 * Phone apps and the owner's phone app: the page itself never zooms (owner, 20.10.2026: «при случайных двойных нажатиях
 * интерфейс увеличивается и не влезает в экран, помогает только переворот телефона… сделай что бы такого увеличения не
 * было и на обычных приложениях телефона и на админ версии»). The viewport is made non-scalable — WKWebView and the
 * Android WebView then drop double-tap and pinch zoom of the page and the zoom-in on a focused input — and Safari's
 * pinch gesture events are cancelled. The map keeps its own pinch zoom: Leaflet reads the touches itself.
 */
export const NO_ZOOM_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover'

const cancel = (event: Event) => event.preventDefault()

export function installNoPageZoom(doc: Document = document) {
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = 'viewport'
    doc.head.appendChild(meta)
  }
  meta.content = NO_ZOOM_VIEWPORT
  doc.documentElement.setAttribute('data-no-zoom', '')
  // iOS: gesturestart/gesturechange are the page pinch; Leaflet works from touch events and is not affected.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.addEventListener(type, cancel, { passive: false })
  return () => {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) doc.removeEventListener(type, cancel)
    doc.documentElement.removeAttribute('data-no-zoom')
  }
}
