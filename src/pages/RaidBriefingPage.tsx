import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Map as MapIcon, Radio, Route } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { RaidBriefingPanel } from '../components/raidprep/RaidBriefingPanel'
import { useRaidMapId } from '../raidprep/useRaidPrep'
import { planRoute } from '../raidprep/route'
import { currentStoryStageIndex, isCurrentTrackedQuest } from '../progression/requirementEngine'
import { questAppliesToMap } from '../progression/questLocation'
import '../styles/raidPrep.css'

/**
 * «Брифинг рейда» page: the selected map, or the map of the current raid when the game logs report one.
 * The route uses the default start (nearest extract); the start can be picked on the Maps page.
 */
export function RaidBriefingPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const progress = state.activeProfile.modes[state.raidMode]
  const raidMapId = useRaidMapId()
  const [followRaid, setFollowRaid] = useState(true)
  const raidMap = raidMapId ? data.maps.find((map) => map.id === raidMapId) : undefined

  // Entering a raid switches the briefing (and the app's selected map) to the raid map.
  useEffect(() => {
    if (followRaid && raidMap && raidMap.id !== state.selectedMapId) state.setSelectedMapId(raidMap.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followRaid, raidMap?.id])

  const mapId = (followRaid && raidMap?.id) || state.selectedMapId
  const map = data.maps.find((entry) => entry.id === mapId) ?? data.maps[0]
  const route = useMemo(() => map ? planRoute(data.markers, data.quests, progress, map.id, null) : null, [data.markers, data.quests, progress, map])
  const counts = useMemo(() => {
    const current = data.quests.filter((quest) => isCurrentTrackedQuest(quest, progress) && !quest.anyMap)
    return new Map(data.maps.map((entry) => [entry.id, current.filter((quest) => questAppliesToMap(quest, entry.id, currentStoryStageIndex(quest, progress))).length]))
  }, [data.maps, data.quests, progress])

  if (!map) return null
  return (
    <div className="page briefing-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Рейд · ')}{uiText(state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase())}</div>
          <h1 className="page-title">{uiText('Брифинг рейда')}</h1>
          <p className="page-subtitle">{uiText('Что сделать на карте по текущим заданиям: цели, предметы, ключи и порядок обхода точек.')}</p>
        </div>
        <div className="briefing-actions">
          {raidMap && (
            <label className="keep-check briefing-live" title={uiText('Карта берётся из журналов игры. Позицию в рейде приложение не знает.')}>
              <input type="checkbox" checked={followRaid} onChange={(event) => setFollowRaid(event.target.checked)} />
              <Radio size={13} />{uiText('В рейде: ')}{uiText(raidMap.name)}
            </label>
          )}
          <Link className="button" to={`/maps/${map.id}`}><MapIcon size={15} />{uiText(' Карта')}</Link>
          <Link className="button primary" to={`/maps/${map.id}?route=1`}><Route size={15} />{uiText(' Маршрут на карте')}</Link>
        </div>
      </header>

      <div className="briefing-maps" role="group" aria-label={uiText('Выбрать карту')}>
        {data.maps.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`briefing-map${entry.id === map.id ? ' active' : ''}`}
            aria-pressed={entry.id === map.id}
            onClick={() => { setFollowRaid(false); state.setSelectedMapId(entry.id) }}
          >
            <span className="map-color" style={{ background: entry.accent }} />
            {uiText(entry.name)}
            {(counts.get(entry.id) ?? 0) > 0 && <small>{counts.get(entry.id)}</small>}
          </button>
        ))}
      </div>

      <RaidBriefingPanel mapId={map.id} route={route} fromRaid={Boolean(followRaid && raidMap && raidMap.id === map.id)} />
    </div>
  )
}
