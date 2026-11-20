import { useEffect, useMemo, useState } from 'react'
import { House, LoaderCircle, Save, Undo2 } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { useTarkovData } from '../data/DataProvider'
import type { RaidMode } from '../domain/types'
import { HIDEOUT_MODULE_MODES, HIDEOUT_MODULES, sanitizeHideoutModules, type HideoutModules } from '../hideout/hideoutModules'
import { setHideoutModules } from '../hideout/hideoutModulesStore'
import { stationIcon } from '../hideout/stationIcons'
import type { AdminRequest } from './ownerAccess'

export const HIDEOUT_MODULES_PATH = '/v1/accounts/me/admin/hideout-modules'

type Choice = 'game' | 'open' | 'hidden'
type Draft = Record<RaidMode, Record<string, Choice>>

const MODE_LABEL: Record<RaidMode, string> = { pvp: 'PvP', pve: 'PvE', seasonal: 'Сезон' }
const CHOICES: ReadonlyArray<{ value: Choice; label: string }> = [
  { value: 'game', label: 'Как в игре' },
  { value: 'open', label: 'Со старта' },
  { value: 'hidden', label: 'Выключен' },
]

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

function draftOf(setting: HideoutModules | null | undefined): Draft {
  const draft: Draft = { pvp: {}, pve: {}, seasonal: {} }
  for (const mode of HIDEOUT_MODULE_MODES) {
    for (const id of setting?.modes[mode]?.open ?? []) draft[mode][id] = 'open'
    for (const id of setting?.modes[mode]?.hidden ?? []) draft[mode][id] = 'hidden'
  }
  return draft
}

const listsOf = (choices: Record<string, Choice>) => ({
  open: Object.keys(choices).filter((id) => choices[id] === 'open').sort(),
  hidden: Object.keys(choices).filter((id) => choices[id] === 'hidden').sort(),
})

/**
 * «Модули убежища» (owner, 20.11.2026: «Включение любого модуля и выключение… по команде… сразу же без обновления приложения
 * появится»): for each mode, every module as in the game, there from the start or turned off, for every player
 * (src/hideout/hideoutModules.ts). Saved on the server (server/src/routes/hideoutModules.ts); the apps get it with the notice
 * within a few minutes.
 */
export function AdminHideoutModules({ request }: { request: AdminRequest }) {
  const { data } = useTarkovData()
  const [saved, setSaved] = useState<HideoutModules | null | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>(() => draftOf(null))
  const [mode, setMode] = useState<RaidMode>('seasonal')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    let alive = true
    void request('GET', HIDEOUT_MODULES_PATH).then((answer) => {
      if (!alive) return
      const value = sanitizeHideoutModules((answer as { modules?: unknown } | null)?.modules)
      setSaved(value)
      setDraft(draftOf(value))
    }).catch((reason: unknown) => { if (alive) { setSaved(null); setError(errorText(reason)) } })
    return () => { alive = false }
  }, [request])

  // The catalog's modules by name, then any the game is known to have or the owner set that the catalog lacks.
  const modules = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; icon?: string }>()
    for (const station of data.hideout) if (station.levels?.length) rows.set(station.id, { id: station.id, name: uiText(station.name), icon: stationIcon(station) })
    for (const known of HIDEOUT_MODULES) if (!rows.has(known.id)) rows.set(known.id, { id: known.id, name: known.name, icon: stationIcon({ normalizedName: known.name }) })
    for (const id of Object.keys(draft[mode])) if (!rows.has(id)) rows.set(id, { id, name: id })
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [data.hideout, draft, mode])

  const before = useMemo(() => draftOf(saved), [saved])
  const changedModes = HIDEOUT_MODULE_MODES.filter((each) => JSON.stringify(listsOf(draft[each])) !== JSON.stringify(listsOf(before[each])))
  const choose = (id: string, choice: Choice) => {
    setDraft((current) => {
      const next = { ...current[mode] }
      if (choice === 'game') delete next[id]
      else next[id] = choice
      return { ...current, [mode]: next }
    })
    setDone('')
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setDone('')
    try {
      let value: HideoutModules | null = saved ?? null
      for (const each of changedModes) {
        const answer = await request('PUT', HIDEOUT_MODULES_PATH, { mode: each, ...listsOf(draft[each]) }) as { modules?: unknown } | null
        if (!answer || !('modules' in answer)) throw new Error('Сервер недоступен')
        value = sanitizeHideoutModules(answer.modules)
      }
      setSaved(value)
      setDraft(draftOf(value))
      // This app shows it at once; the players' apps with their next check of the notice.
      setHideoutModules(value)
      setDone('Сохранено. У игроков — в течение нескольких минут.')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel admin-section" aria-labelledby="admin-hideout-title">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('Убежище у всех игроков')}</div><div className="panel-title" id="admin-hideout-title">{uiLabel('Модули убежища')}</div></div>
        <House size={18} className="brass" aria-hidden="true" />
      </div>
      <div className="panel-body admin-blocks">
        <p className="dim">{uiLabel('Со старта — строится сразу, без других модулей. Выключен — модуля нет в убежище этого режима.')}</p>
        <div className="segmented-filter admin-blocks-view" role="tablist" aria-label={uiLabel('Режим')}>
          {HIDEOUT_MODULE_MODES.map((each) => (
            <button key={each} type="button" role="tab" aria-selected={mode === each} className={mode === each ? 'active' : ''} onClick={() => setMode(each)}>
              {uiLabel(MODE_LABEL[each])}{changedModes.includes(each) ? ' •' : ''}
            </button>
          ))}
        </div>
        {saved === undefined && !error && <small className="dim">{uiLabel('Загрузка с сервера…')}</small>}
        <div className="admin-modules" role="list" aria-label={uiLabel('Модули убежища')}>
          {modules.map((module) => {
            const choice = draft[mode][module.id] ?? 'game'
            return (
              <div key={module.id} role="listitem" className={`admin-module is-${choice}`}>
                <span className="admin-module-name">{module.icon ? <img src={module.icon} alt="" /> : <House size={16} aria-hidden="true" />}{module.name}</span>
                <span className="segmented-filter admin-module-choice" role="radiogroup" aria-label={module.name}>
                  {CHOICES.map(({ value, label }) => (
                    <button key={value} type="button" role="radio" aria-checked={choice === value} className={choice === value ? 'active' : ''} disabled={busy || saved === undefined} onClick={() => choose(module.id, value)}>{uiLabel(label)}</button>
                  ))}
                </span>
              </div>
            )
          })}
        </div>
        <div className="admin-row admin-blocks-actions">
          <button type="button" className="button small primary" disabled={busy || !changedModes.length} onClick={() => void save()}>
            {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Save size={13} aria-hidden="true" />}{uiLabel('Сохранить')}
          </button>
          <button type="button" className="button small ghost" disabled={busy || !changedModes.length} onClick={() => { setDraft(draftOf(saved)); setDone('') }}><Undo2 size={13} aria-hidden="true" />{uiLabel('Отменить правки')}</button>
        </div>
        {done && <small className="admin-done" role="status">{uiLabel(done)}</small>}
        {error && <p className="owner-notices-error" role="alert">{uiLabel(/Не найдено|Неизвестный запрос/.test(error) ? 'Раздел доступен только аккаунту владельца на обновлённом сервере.' : error)}</p>}
      </div>
    </section>
  )
}
