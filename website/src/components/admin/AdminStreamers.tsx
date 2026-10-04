import { Link2, Link2Off, LoaderCircle, Percent, RotateCcw, Save, UserX } from 'lucide-react'
import { useCallback, useState } from 'react'
import { api, type AdminStreamerSettings } from '../../api'
import { useAuth } from '../../auth'
import { Notice } from '../Notice'
import { OwnerAdmin } from '../OwnerAdmin'
import { Loading } from './adminShared'
import { dateOnly, failure, useAdminData, type Failure } from './adminData'

/** «Стримеры»: the existing list, statistics and invitations, plus each streamer's percent and link switch. */
export function AdminStreamers() {
  const [refreshKey, setRefreshKey] = useState(0)
  return <OwnerAdmin refreshKey={refreshKey} extra={<StreamerSettings onChange={() => setRefreshKey((n) => n + 1)} />} />
}

function StreamerSettings({ onChange }: { onChange: () => void }) {
  const { token } = useAuth()
  const settings = useAdminData(useCallback((t: string) => api.adminStreamerSettings(t), []))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Failure | null>(null)

  const apply = async (code: string, action: (t: string) => Promise<AdminStreamerSettings>) => {
    if (!token) return
    setBusy(code); setError(null)
    try {
      settings.setData(await action(token))
      setDrafts((current) => { const next = { ...current }; delete next[code]; return next })
      onChange()
    } catch (reason) {
      setError(failure(reason))
    } finally {
      setBusy(null)
    }
  }

  const data = settings.data
  return (
    <div className="owner-block">
      <div className="field-label"><Percent size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Доля и ссылки стримеров</div>
      {settings.error && <Notice tone={settings.error.offline ? 'offline' : 'error'}>{settings.error.message}</Notice>}
      {error && <Notice tone={error.offline ? 'offline' : 'error'}>{error.message}</Notice>}
      {!data && !settings.error && <Loading />}
      {data && data.streamers.length > 0 && (
        <div className="table-scroll">
          <table className="pay-table admin-table">
            <thead><tr><th scope="col">Стример</th><th scope="col">Доля, %</th><th scope="col">Ссылка</th><th scope="col">Кабинет</th></tr></thead>
            <tbody>
              {data.streamers.map((row) => {
                const draft = drafts[row.code] ?? String(row.percent)
                const value = Number(draft.replace(',', '.'))
                const valid = draft.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100
                return (
                  <tr key={row.code}>
                    <th scope="row"><span className="mono" style={{ color: 'var(--brass-strong)' }}>{row.code}</span><span className="owner-email">{row.email}</span></th>
                    <td>
                      <div className="admin-percent">
                        <input className="input mono" inputMode="decimal" aria-label={`Доля ${row.code}, %`} value={draft} onChange={(e) => setDrafts({ ...drafts, [row.code]: e.target.value })} />
                        <button type="button" className="button small ghost" disabled={busy !== null || !valid || value === row.percent} onClick={() => void apply(row.code, (t) => api.adminSetStreamerPercent(t, row.code, value))}>{busy === row.code ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Save aria-hidden="true" />}Сохранить</button>
                        {row.custom
                          ? <button type="button" className="button small ghost" disabled={busy !== null} title={`Вернуть общую долю ${data.defaultPercent} %`} onClick={() => void apply(row.code, (t) => api.adminSetStreamerPercent(t, row.code, null))}><RotateCcw aria-hidden="true" />Общая</button>
                          : <span className="field-hint">общая</span>}
                      </div>
                    </td>
                    <td>
                      {row.linkEnabled
                        ? <button type="button" className="button small ghost admin-danger" disabled={busy !== null} onClick={() => { if (window.confirm(`Отключить ссылку ${row.code}? Новые переходы и регистрации по ней не будут засчитываться стримеру.`)) void apply(row.code, (t) => api.adminSetStreamerLink(t, row.code, false)) }}><Link2Off aria-hidden="true" />Отключить</button>
                        : <span className="admin-link-off"><span className="tag danger admin-mini">отключена{row.linkDisabledAt ? ` ${dateOnly.format(new Date(row.linkDisabledAt))}` : ''}</span><button type="button" className="button small ghost" disabled={busy !== null} onClick={() => void apply(row.code, (t) => api.adminSetStreamerLink(t, row.code, true))}><Link2 aria-hidden="true" />Включить</button></span>}
                    </td>
                    <td>
                      <button type="button" className="button small ghost admin-danger" disabled={busy !== null} onClick={() => { if (window.confirm(`Снять статус стримера с ${row.email}? Кабинет стримера и бесплатная подписка исчезнут, ссылка ${row.code} перестанет работать. Код останется за аккаунтом, история оплат сохранится.`)) void apply(row.code, (t) => api.adminRevokeStreamer(t, row.code)) }}><UserX aria-hidden="true" />Удалить</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && <span className="field-hint">Общая доля — {data.defaultPercent} % (меняется в приложении владельца, «Оплата»). Своя доля действует только для новых оплат: уже начисленное не пересчитывается. Отключённая ссылка не засчитывает новых переходов и регистраций; уже приглашённые пользователи остаются за стримером, его кабинет и бесплатная подписка сохраняются.</span>}
    </div>
  )
}
