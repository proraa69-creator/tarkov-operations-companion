import { useEffect, useState } from 'react'
import { Eye, EyeOff, LoaderCircle, Megaphone } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { setAnnouncement } from './announcement'

const MAX = 500
const PATH = '/v1/accounts/me/admin/announcement'

interface Saved { text: string; active: boolean; updatedAt: string }

/**
 * The owner app: «Уведомление сверху». The text appears at the top of every player's app within a few minutes («Показать
 * всем») and stays until «Скрыть» (server/src/routes/announcement.ts; the apps check every 3–6 minutes).
 */
export function OwnerAnnouncementPanel() {
  const request = window.tarkovDesktop?.serviceRequest
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<Saved | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!request) return
    let alive = true
    void request('GET', PATH).then((answer) => {
      const value = (answer as { announcement?: Saved | null } | null)?.announcement
      if (!alive || !value) return
      setSaved(value)
      setText(value.text)
    }).catch(() => {})
    return () => { alive = false }
  }, [request])
  if (!request) return null

  const save = async (active: boolean) => {
    setBusy(true)
    setError('')
    try {
      const answer = await request('PUT', PATH, { text: text.trim(), active }) as { announcement?: Saved } | null
      if (!answer?.announcement) throw new Error('Сервер недоступен')
      setSaved(answer.announcement)
      // This app shows it at once too (the others get it from the server the same moment).
      setAnnouncement(answer.announcement.active ? { text: answer.announcement.text, updatedAt: answer.announcement.updatedAt } : null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const shown = Boolean(saved?.active)
  return (
    <section className="panel owner-announcement">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('Для всех игроков')}</div><div className="panel-title">{uiLabel('Уведомление сверху')}</div></div>
        <Megaphone size={18} className={shown ? 'brass' : 'dim'} aria-hidden="true" />
      </div>
      <div className="panel-body owner-announcement-body">
        <textarea className="input" rows={3} maxLength={MAX} value={text} placeholder={uiLabel('Например: ведутся технические работы, приложение заработает через 15 минут.')} onChange={(event) => setText(event.target.value)} />
        <div className="owner-announcement-actions">
          <button type="button" className="button small primary" disabled={busy || !text.trim()} onClick={() => void save(true)}>
            {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}{uiLabel(shown ? 'Обновить у всех' : 'Показать всем')}
          </button>
          <button type="button" className="button small ghost" disabled={busy || !shown} onClick={() => void save(false)}>
            <EyeOff size={13} aria-hidden="true" />{uiLabel('Скрыть')}
          </button>
          <small className="dim">{text.length}/{MAX}</small>
        </div>
        <small className={shown ? 'owner-announcement-state is-on' : 'owner-announcement-state'}>{uiLabel(shown ? 'Показывается у всех.' : 'Сейчас не показывается.')} {uiLabel('Приложения игроков проверяют уведомление раз в 3–6 минут.')}</small>
        {error && <small className="nickname-editor-error" role="alert">{uiLabel(error)}</small>}
      </div>
    </section>
  )
}
