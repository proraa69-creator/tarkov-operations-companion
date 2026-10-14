import { Database, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback } from 'react'
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, numberFormat, useAdminData } from './adminData'

/**
 * «База квестов» (in «Отчёты»): the server's one quest base per mode (server/src/services/questBase.ts, GET
 * /v1/accounts/me/admin/quest-base) — its version, when it was built and checked, the wiki's state, the builder's
 * errors and what changed since the previous version. Read-only.
 */
interface QuestChange { id: string; ru?: string; en?: string }
export interface QuestBaseModeView {
  version: string | null
  builtAt: string | null
  checkedAt: string | null
  sources: { wiki?: { state?: string; fetchedAt?: string } } | null
  counts: Record<string, number>
  changes: { since: string | null; added: QuestChange[]; removed: QuestChange[]; renamed: Array<{ id: string; lang: 'ru' | 'en'; from: string; to: string }> } | null
  state: { building: boolean; failures: number; lastError: string | null; nextBuildAt: string | null; savedToDisk: boolean }
}
export interface QuestBaseView { periodMinutes: number; modes: Record<'pvp' | 'pve' | 'seasonal', QuestBaseModeView> }

const MODES = [['pvp', 'PvP'], ['pve', 'PvE'], ['seasonal', 'Сезон']] as const
const WIKI_STATE: Record<string, string> = { fetched: 'прочитана', cached: 'из сохранённой копии', stale: 'недоступна, старая копия', failed: 'недоступна', idle: 'не читалась' }
/** Changes shown per list; the rest are counted. */
const SHOWN = 40

const when = (value: string | null | undefined) => (value ? dateTime.format(new Date(value)) : '—')
const titleOf = (change: QuestChange) => [change.ru, change.en].filter(Boolean).join(' / ') || change.id

async function loadQuestBase(token: string): Promise<QuestBaseView> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/v1/accounts/me/admin/quest-base`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : `Ошибка сервера (HTTP ${response.status})`)
  return data as QuestBaseView
}

function ChangeList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="field-label">{label} · {items.length}</div>
      <ul className="admin-wrap" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
        {items.slice(0, SHOWN).map((item, index) => <li key={index}>{item}</li>)}
        {items.length > SHOWN && <li className="dim">и ещё {items.length - SHOWN}</li>}
      </ul>
    </div>
  )
}

export function AdminQuestBase() {
  const base = useAdminData(useCallback((token: string) => loadQuestBase(token), []))
  const data = base.data
  return (
    <div className="admin-stack">
      <div className="admin-section-head">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><Database aria-hidden="true" size={16} />База квестов</h3>
        <button type="button" className="button ghost small" disabled={base.loading} onClick={() => void base.refresh()}>
          {base.loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        Сервер собирает квесты каждого режима на русском и английском {data ? `раз в ${data.periodMinutes} мин` : 'по расписанию'} и
        после каждой загрузки tarkov.dev и хранит их на диске; приложения игроков получают их только с сервера.
      </p>
      {base.error && <Notice tone={base.error.offline ? 'offline' : 'error'}>{base.error.message}</Notice>}
      {!data && !base.error && <Loading text="Загружаем базу квестов…" />}
      {data && (
        <div className="table-scroll">
          <table className="pay-table admin-table">
            <thead>
              <tr>
                <th scope="col">Режим</th><th scope="col">Версия</th><th scope="col">Собрана</th><th scope="col">Проверена</th>
                <th scope="col">Квесты</th><th scope="col">Вики</th><th scope="col">Сборка</th>
              </tr>
            </thead>
            <tbody>
              {MODES.map(([mode, label]) => {
                const row = data.modes[mode]
                const wiki = row.sources?.wiki
                return (
                  <tr key={mode}>
                    <th scope="row">{label}</th>
                    <td className="mono">{row.version ?? <span className="dim">ещё нет</span>}</td>
                    <td className="mono">{when(row.builtAt)}</td>
                    <td className="mono">{when(row.checkedAt)}</td>
                    <td>
                      {numberFormat.format(row.counts.quests ?? 0)}
                      <span className="dim"> · с двумя названиями {numberFormat.format(row.counts.bothTitles ?? 0)} · глав {numberFormat.format(row.counts.storyChapters ?? 0)}</span>
                    </td>
                    <td>{wiki?.state ? WIKI_STATE[wiki.state] ?? wiki.state : '—'}{wiki?.fetchedAt ? <span className="dim mono"> · {when(wiki.fetchedAt)}</span> : null}</td>
                    <td className="admin-wrap">
                      {row.state.building ? <span className="tag admin-mini">собирается</span>
                        : row.state.failures > 0 ? <span className="tag danger admin-mini" title={row.state.lastError ?? undefined}>ошибка × {row.state.failures}</span>
                          : <span className="tag green admin-mini">в порядке</span>}
                      {row.state.failures > 0 && row.state.lastError ? <span className="dim"> {row.state.lastError}</span> : null}
                      {!row.state.savedToDisk && <span className="tag danger admin-mini">не записана на диск</span>}
                      <span className="dim mono"> · следующая {when(row.state.nextBuildAt)}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && MODES.map(([mode, label]) => {
        const changes = data.modes[mode].changes
        if (!changes?.since) return null
        const total = changes.added.length + changes.removed.length + changes.renamed.length
        return (
          <details key={mode}>
            <summary>{label}: {total ? `+${changes.added.length} −${changes.removed.length} ~${changes.renamed.length}` : 'без изменений квестов'} с версии <span className="mono">{changes.since}</span></summary>
            <ChangeList label="Новые" items={changes.added.map(titleOf)} />
            <ChangeList label="Убраны" items={changes.removed.map(titleOf)} />
            <ChangeList label="Переименованы" items={changes.renamed.map((entry) => `${entry.from} → ${entry.to} (${entry.lang === 'ru' ? 'рус.' : 'англ.'})`)} />
          </details>
        )
      })}
    </div>
  )
}
