import { LoaderCircle, MapPinned, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { ApiError, NETWORK_ERROR_MESSAGE } from '../../api'
import { API_URL } from '../../config'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, useAdminData, type Failure } from './adminData'

/**
 * «Исправленные точки квестов» (in «Баг-репорты»): the quest map points the owner corrected in the owner app
 * («Карты» → «Квесты: правка точек», server/src/routes/questPoints.ts). Read-only here, plus «Вернуть исходную».
 */
export interface QuestPointOverrideRow {
  id: string
  questId: string
  markerId?: string
  objectiveId?: string
  stageIndex?: number
  mapId: string
  x: number
  z: number
  floor?: string
  kind: 'move' | 'add' | 'hide'
  note?: string
  updatedBy?: string
  updatedAt?: string
}

const BASE = '/v1/accounts/me/admin/quest-points'
const KIND_LABEL: Record<QuestPointOverrideRow['kind'], string> = { move: 'Перенесена', add: 'Добавлена', hide: 'Скрыта' }

async function call<T>(token: string, path: string, method: 'GET' | 'POST'): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_URL}${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  } catch {
    throw new ApiError(0, NETWORK_ERROR_MESSAGE, true)
  }
  const data = await response.json().catch(() => undefined) as { error?: unknown } | undefined
  if (!response.ok) throw new ApiError(response.status, typeof data?.error === 'string' ? data.error : response.status === 404 ? 'Раздел доступен только владельцу (или сервер ещё не обновлён).' : `Ошибка сервера (HTTP ${response.status})`)
  return data as T
}

const questPointsApi = {
  list: (token: string) => call<{ overrides: QuestPointOverrideRow[] }>(token, '', 'GET'),
  reset: (token: string, id: string) => call<{ overrides: QuestPointOverrideRow[] }>(token, `/${id}/remove`, 'POST'),
}

export function AdminQuestPoints() {
  const list = useAdminData(useCallback((token: string) => questPointsApi.list(token), []))
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState<Failure | null>(null)
  const rows = list.data ? [...list.data.overrides].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')) : null

  async function reset(id: string) {
    if (!list.token || !window.confirm('Вернуть исходную точку? Правка удалится у всех игроков.')) return
    setBusy(id)
    setActionError(null)
    try {
      list.setData(await questPointsApi.reset(list.token, id))
    } catch (reason) {
      setActionError(failure(reason))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-section-head">
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><MapPinned aria-hidden="true" size={16} />Исправленные точки квестов</h3>
        <button type="button" className="button ghost small" disabled={list.loading} onClick={() => void list.refresh()}>
          {list.loading ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Обновить
        </button>
      </div>
      <p className="field-hint" style={{ margin: 0 }}>
        Правятся в серверном приложении: «Карты» → «Квесты: правка точек». Исправления видят все игроки во всех режимах.
      </p>
      {list.error && <Notice tone={list.error.offline ? 'offline' : 'error'}>{list.error.message}</Notice>}
      {actionError && <Notice tone={actionError.offline ? 'offline' : 'error'}>{actionError.message}</Notice>}
      {!rows && !list.error && <Loading text="Загружаем правки…" />}
      {rows && rows.length === 0 && <div className="muted admin-empty">Исправленных точек нет.</div>}
      {rows && rows.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table">
            <thead>
              <tr>
                <th scope="col">Дата</th><th scope="col">Квест</th><th scope="col">Карта</th><th scope="col">Правка</th>
                <th scope="col">Координаты</th><th scope="col">Заметка</th><th scope="col"><span className="visually-hidden">Действия</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{row.updatedAt ? dateTime.format(new Date(row.updatedAt)) : '—'}</td>
                  <th scope="row" className="mono admin-wrap" title={row.markerId}>{row.questId}{row.stageIndex != null ? ` · этап ${row.stageIndex + 1}` : ''}</th>
                  <td>{row.mapId}{row.floor ? <span className="dim"> · {row.floor}</span> : null}</td>
                  <td>{KIND_LABEL[row.kind]}</td>
                  <td className="mono">x {Math.round(row.x)}, z {Math.round(row.z)}</td>
                  <td className="admin-wrap">{row.note ?? <span className="dim">—</span>}</td>
                  <td className="admin-row-action">
                    <button type="button" className="button ghost small" disabled={busy === row.id} onClick={() => void reset(row.id)}>
                      {busy === row.id ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}Вернуть исходную
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
