export interface WikiMapMarker {
  id?: string | number
  categoryId?: string
  name?: string
  popup?: { title?: string; description?: string }
}

export interface WikiQuestPin {
  id: string
  title: string
  description?: string
  x: number
  z: number
  focused?: boolean
}

export interface WikiLandmark {
  name: string
  x: number
  z: number
}

export interface WikiMapPinPayload {
  searchTerms: string[]
  pins: WikiQuestPin[]
  landmarks: WikiLandmark[]
}

const GENERIC = /^(спавн|выход|переход|карта|квест|лут|контейнер|дикие|чвк)$/i
const PREFERRED_CATEGORY = /loot_|locked|lever|key|quest/i

export function normalizeWikiText(value: string) {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function wikiSearchTokens(terms: string[]) {
  const tokens: string[] = []
  for (const term of terms) {
    const cleaned = term.replace(/\[\[.*?\]\]/g, ' ').replace(/<[^>]+>/g, ' ').trim()
    if (cleaned.length >= 3) tokens.push(cleaned)
    for (const room of cleaned.match(/\d{2,4}/g) ?? []) tokens.push(room)
    for (const quoted of cleaned.match(/[«"]([^»"]{3,})[»"]/g) ?? []) tokens.push(quoted.replace(/[«»"]/g, ''))
  }
  return [...new Set(tokens.map((token) => token.trim()).filter((token) => token.length >= 2 && !GENERIC.test(token)))]
}

export function matchWikiMarker(markers: WikiMapMarker[], terms: string[]) {
  const queries = wikiSearchTokens(terms).map(normalizeWikiText).filter((query) => query.length >= 2)
  if (!queries.length) return undefined
  let best: { id: string; score: number } | undefined
  for (const marker of markers) {
    const id = String(marker.id ?? '')
    if (!id) continue
    const title = normalizeWikiText(marker.popup?.title || marker.name || '')
    const description = normalizeWikiText(marker.popup?.description || '')
    const haystack = `${title} ${description}`
    if (!title && !description) continue
    let score = 0
    for (const query of queries) {
      if (title === query) score = Math.max(score, 100)
      else if (title.includes(query) || query.includes(title) && title.length >= 4) score = Math.max(score, 78)
      else if (haystack.includes(query)) score = Math.max(score, query.length >= 4 ? 64 : 48)
    }
    if (PREFERRED_CATEGORY.test(marker.categoryId ?? '')) score += 8
    if (score && (!best || score > best.score)) best = { id, score }
  }
  return best && best.score >= 48 ? best.id : undefined
}

export function wikiMapGuestScript(input: string[] | WikiMapPinPayload) {
  const payload: WikiMapPinPayload = Array.isArray(input)
    ? { searchTerms: input, pins: [], landmarks: [] }
    : {
        searchTerms: input.searchTerms ?? [],
        pins: input.pins ?? [],
        landmarks: input.landmarks ?? [],
      }
  return `(${pinQuestOnWikiMap.toString()})(${JSON.stringify(payload)})`
}

export function pinQuestOnWikiMap(payload: WikiMapPinPayload) {
  const hideChrome = () => {
    const styleId = 'tarkov-ops-wiki-map-chrome'
    if (document.getElementById(styleId)) return
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .global-navigation, .fandom-sticky-header, .page__right-rail, .global-footer,
      .top-ads-container, #WikiaBar, .notifications-placeholder, .page-header,
      .page-footer, .community-header-wrapper, #globalNavigation, .top-bar,
      .page-header__bottom, .page-header__title, .page-header__actions,
      .wds-global-navigation, .unified-search__container, .fandom-community-header,
      .right-rail-wrapper, .page__main > .page-header, .license-description,
      .interactive-maps-description, #mixed-content-footer, .global-footer,
      .bottom-ads-container, .age-gate, .onetrust-pc-dark-filter { display: none !important; }
      html, body, .main-container, .resizable-container, .page, .page__main,
      .mw-parser-output, .interactive-maps-container, .interactive-maps,
      .interactive-maps__wrapper, .interactive-maps__container { height: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      .interactive-map-6ab569a6a10c1, [class*="interactive-map-"] { height: 100vh !important; }
      .toc-quest-pin { background: transparent !important; border: 0 !important; }
      .toc-quest-pin-dot { width: 28px; height: 28px; border: 2px solid #0d140f; border-radius: 50% 50% 50% 8px; background: #d5b76f; color: #0d140f; transform: rotate(-45deg); display: grid; place-items: center; box-shadow: 0 6px 18px rgb(0 0 0 / 55%); }
      .toc-quest-pin-dot span { transform: rotate(45deg); display: block; font: 900 13px/1 sans-serif; }
      .toc-quest-pin.is-focused .toc-quest-pin-dot { background: #f0d27a; box-shadow: 0 0 0 3px rgb(240 210 122 / 35%), 0 8px 18px rgb(0 0 0 / 60%); }
    `
    document.documentElement.appendChild(style)
  }

  const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const searchTerms = payload.searchTerms ?? []
  const pins = payload.pins ?? []
  const landmarks = payload.landmarks ?? []
  const queries = searchTerms
    .flatMap((term) => {
      const cleaned = String(term || '').replace(/\[\[.*?\]\]/g, ' ').replace(/<[^>]+>/g, ' ')
      return [cleaned, ...(cleaned.match(/\d{2,4}/g) ?? [])]
    })
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)

  const clickSidebarMarker = (markerId: string) => {
    const pattern = new RegExp(`\\(${markerId}\\)\\s*$`)
    const hit = [...document.querySelectorAll('.mapsExtended_sidebarWrapper button, .mapsExtended_sidebarWrapper a, .mapsExtended_sidebarWrapper li, .mapsExtended_sidebarWrapper span')]
      .find((element) => pattern.test((element.textContent || '').replace(/\s+/g, ' ').trim()))
    ;(hit as HTMLElement | undefined)?.click()
  }

  const fillSearch = (query: string) => {
    const input = document.querySelector('.mapsExtended_sidebarControl') as HTMLInputElement | null
    if (!input || !query) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, query)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    setTimeout(() => {
      const result = [...document.querySelectorAll('.mapsExtended_sidebarWrapper button, .mapsExtended_sidebarWrapper a, .mapsExtended_sidebarWrapper li')]
        .find((element) => normalize(element.textContent || '').includes(normalize(query)) && !/нет результатов/i.test(element.textContent || ''))
      ;(result as HTMLElement | undefined)?.click()
    }, 200)
  }

  const scoreLandmarkName = (landmark: string, title: string) => {
    const query = normalize(landmark)
    const name = normalize(title)
    if (!query || !name) return 0
    if (name === query) return 100
    if (name.startsWith(`${query} `) || query.startsWith(`${name} `)) return 88
    const shorter = query.length <= name.length ? query : name
    const longer = query.length <= name.length ? name : query
    if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.55) return 72
    return 0
  }

  const matchPairs = (gameLandmarks: typeof landmarks, wikiPoints: Array<{ title: string; position: [number, number]; categoryId?: string }>) => {
    const extracts = wikiPoints.filter((point) => !point.categoryId || /^exfil_/i.test(point.categoryId))
    const pool = extracts.length ? extracts : wikiPoints
    const candidates: Array<{ score: number; landmark: (typeof landmarks)[number]; wiki: (typeof pool)[number] }> = []
    for (const landmark of gameLandmarks) {
      for (const wiki of pool) {
        const score = scoreLandmarkName(landmark.name, wiki.title)
        if (score >= 88) candidates.push({ score, landmark, wiki })
      }
    }
    candidates.sort((left, right) => right.score - left.score)
    const usedLandmarks = new Set<string>()
    const usedWiki = new Set<(typeof pool)[number]>()
    const pairs: Array<{ gameX: number; gameZ: number; wikiX: number; wikiY: number }> = []
    for (const candidate of candidates) {
      const key = `${candidate.landmark.name}:${candidate.landmark.x}:${candidate.landmark.z}`
      if (usedLandmarks.has(key) || usedWiki.has(candidate.wiki)) continue
      usedLandmarks.add(key)
      usedWiki.add(candidate.wiki)
      pairs.push({
        gameX: candidate.landmark.x,
        gameZ: candidate.landmark.z,
        wikiX: candidate.wiki.position[0],
        wikiY: candidate.wiki.position[1],
      })
    }
    return pairs
  }

  const fitSimilarity = (pairs: Array<{ gameX: number; gameZ: number; wikiX: number; wikiY: number }>) => {
    if (pairs.length < 2) return undefined
    const count = pairs.length
    const meanGX = pairs.reduce((sum, pair) => sum + pair.gameX, 0) / count
    const meanGZ = pairs.reduce((sum, pair) => sum + pair.gameZ, 0) / count
    const meanWX = pairs.reduce((sum, pair) => sum + pair.wikiX, 0) / count
    const meanWY = pairs.reduce((sum, pair) => sum + pair.wikiY, 0) / count
    let c1 = 0
    let c2 = 0
    let norm = 0
    for (const pair of pairs) {
      const gx = pair.gameX - meanGX
      const gz = pair.gameZ - meanGZ
      const wx = pair.wikiX - meanWX
      const wy = pair.wikiY - meanWY
      c1 += gx * wx + gz * wy
      c2 += gx * wy - gz * wx
      norm += gx * gx + gz * gz
    }
    if (norm < 1e-6) return undefined
    const a = c1 / norm
    const b = c2 / norm
    return { a, b, tx: meanWX - a * meanGX + b * meanGZ, ty: meanWY - b * meanGX - a * meanGZ }
  }

  const applyTransform = (transform: { a: number; b: number; tx: number; ty: number }, gameX: number, gameZ: number): [number, number] => [
    transform.a * gameX - transform.b * gameZ + transform.tx,
    transform.b * gameX + transform.a * gameZ + transform.ty,
  ]

  const fitRobust = (pairs: Array<{ gameX: number; gameZ: number; wikiX: number; wikiY: number }>, maxError = 140) => {
    if (pairs.length < 2) return undefined
    if (pairs.length === 2) return fitSimilarity(pairs)
    let bestInliers = [] as typeof pairs
    const consider = (seed: typeof pairs) => {
      const fitted = fitSimilarity(seed)
      if (!fitted) return
      const inliers = pairs.filter((pair) => {
        const [wikiX, wikiY] = applyTransform(fitted, pair.gameX, pair.gameZ)
        return Math.hypot(wikiX - pair.wikiX, wikiY - pair.wikiY) <= maxError
      })
      if (inliers.length > bestInliers.length) bestInliers = inliers
    }
    const count = pairs.length
    if (count <= 24) {
      for (let i = 0; i < count; i += 1) {
        for (let j = i + 1; j < count; j += 1) consider([pairs[i], pairs[j]])
      }
    } else {
      for (let sample = 0; sample < 80; sample += 1) {
        const i = Math.floor(Math.random() * count)
        const j = (i + 1 + Math.floor(Math.random() * (count - 1))) % count
        consider([pairs[i], pairs[j]])
      }
    }
    consider(pairs)
    return bestInliers.length >= 2 ? fitSimilarity(bestInliers) : fitSimilarity(pairs)
  }

  const captureLeafletMap = () => {
    const host = window as unknown as {
      L?: { Map?: { prototype?: Record<string, unknown> } }
      __tocWikiMap?: {
        getContainer?: () => Element | null
        removeLayer?: (layer: unknown) => void
        flyTo?: (latlng: unknown, zoom?: number, options?: unknown) => void
        setView?: (latlng: unknown, zoom?: number) => void
        getZoom?: () => number
        addLayer?: (layer: unknown) => void
        getPane?: (name: string) => Element | null
      }
    }
    const isMap = (value: unknown): value is NonNullable<typeof host.__tocWikiMap> => {
      const map = value as NonNullable<typeof host.__tocWikiMap> | undefined
      return Boolean(map && typeof map.flyTo === 'function' && typeof map.addLayer === 'function' && typeof map.getPane === 'function')
    }
    if (isMap(host.__tocWikiMap) && host.__tocWikiMap.getContainer?.()?.isConnected) return host.__tocWikiMap
    const container = document.querySelector('.leaflet-container') as (HTMLElement & { _leaflet_id?: number }) | null
    const fiberKey = container ? Object.keys(container).find((key) => key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')) : undefined
    const walkFiber = (node: { stateNode?: unknown; memoizedProps?: { map?: unknown }; pendingProps?: { map?: unknown }; memoizedState?: { memoizedState?: unknown; next?: unknown }; return?: unknown; child?: unknown } | undefined, depth: number): NonNullable<typeof host.__tocWikiMap> | undefined => {
      if (!node || depth > 90) return undefined
      if (isMap(node.stateNode)) return node.stateNode
      const stateNode = node.stateNode as { map?: unknown } | undefined
      if (isMap(stateNode?.map)) return stateNode.map
      if (isMap(node.memoizedProps?.map)) return node.memoizedProps.map
      if (isMap(node.pendingProps?.map)) return node.pendingProps.map
      let hook = node.memoizedState
      let index = 0
      while (hook && index < 50) {
        const value = hook.memoizedState as { current?: unknown; map?: unknown } | undefined
        if (isMap(value)) return value
        if (isMap(value?.current)) return value.current
        if (isMap(value?.map)) return value.map
        hook = hook.next as typeof hook
        index += 1
      }
      return walkFiber(node.return as typeof node, depth + 1)
    }
    const fromFiber = fiberKey && container ? walkFiber((container as unknown as Record<string, unknown>)[fiberKey] as Parameters<typeof walkFiber>[0], 0) : undefined
    if (fromFiber) {
      host.__tocWikiMap = fromFiber
      return fromFiber
    }
    const proto = host.L?.Map?.prototype
    if (proto && !(proto.setView as { __tocWrapped?: boolean } | undefined)?.__tocWrapped) {
      for (const name of ['setView', 'flyTo', 'panTo', 'setZoom', 'fitBounds', '_resetView', 'invalidateSize', 'addLayer']) {
        const original = proto[name]
        if (typeof original !== 'function') continue
        proto[name] = function wrappedLeafletMethod(...args: unknown[]) {
          host.__tocWikiMap = this as typeof host.__tocWikiMap
          return (original as (...inner: unknown[]) => unknown).apply(this, args)
        }
      }
      ;(proto.setView as { __tocWrapped?: boolean }).__tocWrapped = true
    }
    try { window.dispatchEvent(new Event('resize')) } catch { /* Leaflet may listen on window resize. */ }
    ;(document.querySelector('.leaflet-control-zoom-out') as HTMLElement | null)?.click()
    ;(document.querySelector('.leaflet-control-zoom-in') as HTMLElement | null)?.click()
    return isMap(host.__tocWikiMap) ? host.__tocWikiMap : undefined
  }

  const plotQuestPins = (
    map: NonNullable<ReturnType<typeof captureLeafletMap>>,
    wikiPoints: Array<{ title: string; position: [number, number]; categoryId?: string }>,
  ) => {
    try {
      const leaflet = (window as unknown as { L?: { latLng: (lat: number, lng: number) => unknown; divIcon: (options: unknown) => unknown; marker: (latlng: unknown, options: unknown) => { addTo: (target: unknown) => { bindPopup: (html: string) => { openPopup?: () => void } } } } }).L
      if (!leaflet) return { ok: false, reason: 'no-leaflet' }
      const pairs = matchPairs(landmarks, wikiPoints)
      const transform = fitRobust(pairs)
      if (!transform) return { ok: false, reason: `no-transform:${pairs.length}` }
      const bag = window as unknown as { __tocQuestLayers?: unknown[] }
      for (const layer of bag.__tocQuestLayers ?? []) map.removeLayer?.(layer)
      bag.__tocQuestLayers = []
      let focusedLatLng: unknown
      const seen = new Set<string>()
      for (const pin of pins) {
        const key = `${Math.round(pin.x)}:${Math.round(pin.z)}:${pin.title}`
        if (seen.has(key)) continue
        seen.add(key)
        const [wikiX, wikiY] = applyTransform(transform, pin.x, pin.z)
        if (!Number.isFinite(wikiX) || !Number.isFinite(wikiY)) continue
        const latlng = leaflet.latLng(wikiY, wikiX)
        const icon = leaflet.divIcon({
          className: `toc-quest-pin${pin.focused ? ' is-focused' : ''}`,
          html: '<div class="toc-quest-pin-dot"><span>!</span></div>',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
          popupAnchor: [0, -28],
        })
        const marker = leaflet.marker(latlng, { icon, zIndexOffset: pin.focused ? 2000 : 1200, title: pin.title }).addTo(map)
        marker.bindPopup(`<b>${pin.title}</b>${pin.description ? `<br>${pin.description}` : ''}`)
        if (pin.focused) focusedLatLng = latlng
        bag.__tocQuestLayers.push(marker)
      }
      if (!bag.__tocQuestLayers.length) return { ok: false, reason: 'no-layers' }
      if (focusedLatLng) {
        const zoom = Math.min(1, Math.max(map.getZoom?.() ?? -2, -1))
        map.setView?.(focusedLatLng, zoom)
        map.flyTo?.(focusedLatLng, zoom, { duration: 0.35 })
      }
      return { ok: true, reason: 'pinned', pinCount: bag.__tocQuestLayers.length, pairs: pairs.length }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'plot-failed' }
    }
  }

  const searchWikiMarker = (markers: Array<{ id?: string; categoryId?: string; popup?: { title?: string; description?: string }; name?: string }>) => {
    let bestId = ''
    let bestScore = 0
    for (const marker of markers) {
      const id = String(marker.id ?? '')
      const title = normalize(marker.popup?.title || marker.name || '')
      const description = normalize(marker.popup?.description || '')
      const haystack = `${title} ${description}`
      let score = 0
      for (const query of queries.map(normalize).filter(Boolean)) {
        if (title === query) score = Math.max(score, 100)
        else if (title.includes(query) || (query.includes(title) && title.length >= 4)) score = Math.max(score, 78)
        else if (haystack.includes(query)) score = Math.max(score, query.length >= 4 ? 64 : 48)
      }
      if (/loot_|locked|lever|key|quest/i.test(marker.categoryId ?? '')) score += 8
      if (score > bestScore) {
        bestScore = score
        bestId = id
      }
    }
    if (bestId && bestScore >= 48) {
      const next = new URL(location.href)
      next.searchParams.set('marker', bestId)
      if (location.search !== next.search) history.replaceState(null, '', next)
      clickSidebarMarker(bestId)
      return true
    }
    const fallback = queries.find((query) => query.length >= 3)
    if (fallback) fillSearch(fallback)
    return Boolean(fallback)
  }

  const run = () => {
    hideChrome()
    const config = (window as unknown as { mw?: { config?: { get?: (key: string) => Record<string, { markers?: Array<{ id?: string; categoryId?: string; popup?: { title?: string; description?: string }; name?: string; position?: [number, number] }> }> } } }).mw?.config?.get?.('interactiveMaps')
    const markers = config ? Object.values(config)[0]?.markers ?? [] : []
    const wikiPoints = markers
      .filter((marker) => Array.isArray(marker.position) && marker.position.length >= 2)
      .map((marker) => ({
        title: marker.popup?.title || marker.name || '',
        position: marker.position as [number, number],
        categoryId: marker.categoryId,
      }))
    const map = captureLeafletMap()
    if (pins.length && landmarks.length && map) {
      const plotted = plotQuestPins(map, wikiPoints)
      if (plotted.ok) return plotted
      if (queries.length) searchWikiMarker(markers)
      return plotted
    }
    if (pins.length && landmarks.length && !map) return { ok: false, reason: 'no-map', pinCount: pins.length, wikiPoints: wikiPoints.length }
    if (queries.length) searchWikiMarker(markers)
    return { ok: false, reason: pins.length ? 'not-plotted' : 'no-pins' }
  }

  hideChrome()
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      const ready = document.querySelector('.leaflet-container') || document.querySelector('.mapsExtended_sidebarControl') || document.querySelector('.interactive-maps')
      if (ready || Date.now() - started > 12_000) {
        window.clearInterval(timer)
        resolve(run())
      }
    }, 250)
  })
}
