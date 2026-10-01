import { uiText } from '../../i18n/renderText'
import { useMemo } from 'react'
import { divIcon } from 'leaflet'
import { Marker, Polyline, Tooltip, useMapEvents } from 'react-leaflet'
import { Flag, MousePointerClick, Route, RotateCcw } from 'lucide-react'
import type { RaidRouteState } from '../../raidprep/useRaidPrep'
import '../../styles/raidPrep.css'

/** Numbered steps and the path of the route, drawn inside the Leaflet map. Clicks set the start while picking. */
export function RaidRouteLayer({ route }: { route: RaidRouteState }) {
  useMapEvents({
    click: (event) => {
      if (route.picking) route.setStart([event.latlng.lat, event.latlng.lng])
    },
  })
  const { plan } = route
  const startIcon = useMemo(() => divIcon({ className: 'raid-route-start-icon', html: '<span class="raid-route-start">S</span>', iconSize: [26, 26], iconAnchor: [13, 13] }), [])
  if (!route.enabled) return null
  const path = plan.start ? [plan.start, ...plan.steps.map((step) => step.position)] : plan.steps.map((step) => step.position)
  return (
    <>
      {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#f2d27a', weight: 3, opacity: 0.9, dashArray: '9 7' }} interactive={false} />}
      {plan.start && (
        <Marker position={plan.start} icon={startIcon} interactive zIndexOffset={1100}>
          <Tooltip direction="top" offset={[0, -14]}>{plan.startIsCustom ? uiText('Старт (выбран вами)') : <>{uiText('Старт: ')}{uiText(plan.startExtract ?? 'выход')} {uiText('(по умолчанию)')}</>}</Tooltip>
        </Marker>
      )}
      {plan.steps.map((step, index) => (
        <Marker
          key={step.id}
          position={step.position}
          icon={divIcon({ className: 'raid-route-step-icon', html: `<span class="raid-route-step">${index + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 30] })}
          interactive
          zIndexOffset={1000}
        >
          <Tooltip direction="top" offset={[0, -30]}>{uiText(step.title)}</Tooltip>
        </Marker>
      ))}
    </>
  )
}

/** «Маршрут» button and its start controls for the map HUD. */
export function RaidRouteControls({ route }: { route: RaidRouteState }) {
  return (
    <div className={`raid-route-controls${route.enabled ? ' is-on' : ''}`}>
      <button type="button" className={`map-tool${route.enabled ? ' active' : ''}`} aria-pressed={route.enabled} onClick={route.toggle} title={uiText('Порядок обхода точек текущих заданий на этой карте')}>
        <Route size={14} /><span>{uiText('Маршрут')}</span>
      </button>
      {route.enabled && (
        <>
          <button type="button" className={`map-tool${route.picking ? ' active' : ''}`} aria-pressed={route.picking} onClick={() => route.setPicking(!route.picking)} title={uiText('Кликните по карте там, где вы появились — маршрут начнётся оттуда')}>
            <MousePointerClick size={14} /><span>{uiText('Указать старт')}</span>
          </button>
          {route.plan.startIsCustom && (
            <button type="button" className="map-tool icon" onClick={route.resetStart} title={uiText('Вернуть старт от ближайшего выхода')}><RotateCcw size={14} /></button>
          )}
        </>
      )}
    </div>
  )
}

/** Hint over the map while the route is on: the app does not know the spawn, the user picks the start. */
export function RaidRouteHint({ route }: { route: RaidRouteState }) {
  if (!route.enabled) return null
  return (
    <div className="raid-route-hint" role="status">
      <Flag size={13} />
      {uiText(route.picking
        ? 'Кликните по карте там, где вы появились.'
        : route.plan.startIsCustom
          ? 'Старт выбран вами. Приложение не знает точку спавна.'
          : 'Старт — ближайший к точкам выход. Приложение не знает точку спавна: укажите старт сами.')}
    </div>
  )
}
