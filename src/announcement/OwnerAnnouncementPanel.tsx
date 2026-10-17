import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, History, LoaderCircle, Megaphone, Pencil } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { setAnnouncement } from './announcement'

const MAX = 500
const PATH = '/v1/accounts/me/admin/announcement'
const HISTORY_PATH = '/v1/accounts/me/admin/announcement/history'
/** Under the Russian field (server/src/services/announcementLanguage.ts). */
const HINT = 'Пишите по-русски. Игроки из СНГ и из неизвестных стран видят этот текст, остальные — английский перевод, он делается сам.'
const NO_ENGLISH = 'Перевод не получился — иностранцы видят русский текст. Впишите английский вручную.'

/**
 * The notice as the server keeps it: the owner's Russian and the English every other country reads (null: none, they
 * read the Russian; absent: a server from before the English).
 */
interface Saved { text: string; textEn?: string | null; textEnSource?: 'auto' | 'manual' | null; active: boolean; updatedAt: string }
/** One past banner (server/src/services/announcementStore.ts AnnouncementHistoryEntry). */
interface HistoryEntry { id: number; text: string; textEn: string | null; updatedAt: string }

const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const when = (value: string) => { try { return dateTime.format(new Date(value)) } catch { return value } }

/**
 * The owner app: «Баннер». The text appears at the top of every player's app within a few minutes («Показать всем») and
 * stays until «Скрыть» (server/src/routes/announcement.ts; the apps check every 3–6 minutes). The compose field starts
 * empty every time (owner, 16.10.2026: «В банере тоже не должно сохранятся предыдущее уведомление»); the past banners
 * are kept in «История баннеров». The owner writes Russian; foreign players get the English made at the save.
 */
export function OwnerAnnouncementPanel() {
  const request = window.tarkovDesktop?.serviceRequest
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<Saved | null>(null)
  const [history, setHistory] = useState<HistoryEntry[] | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const loadHistory = () => request?.('GET', HISTORY_PATH).then((answer) => {
    const list = (answer as { history?: HistoryEntry[] } | null)?.history
    if (list) setHistory(list)
  }).catch(() => {})
  useEffect(() => {
    if (!request) return
    let alive = true
    // The current banner is loaded only for its state and English; the compose field stays empty on purpose.
    void request('GET', PATH).then((answer) => {
      const value = (answer as { announcement?: Saved | null } | null)?.announcement
      if (alive && value) setSaved(value)
    }).catch(() => {})
    void loadHistory()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])
  if (!request) return null

  /** `textEn`: the owner's own English, instead of the automatic one. The notice as saved, or undefined. */
  const send = async (body: { text: string; active: boolean; textEn?: string }) => {
    setBusy(true)
    setError('')
    try {
      const answer = await request('PUT', PATH, body) as { announcement?: Saved } | null
      if (!answer?.announcement) throw new Error('Сервер недоступен')
      setSaved(answer.announcement)
      // This app shows it at once too (the others get it from the server the same moment).
      setAnnouncement(answer.announcement.active ? { text: answer.announcement.text, updatedAt: answer.announcement.updatedAt } : null)
      return answer.announcement
    } catch (reason) {
      setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : String(reason))
      return undefined
    } finally {
      setBusy(false)
    }
  }
  /** «Показать всем»: a new banner from the compose field; the field clears and it joins the history. */
  const show = async () => {
    const stored = await send({ text: text.trim(), active: true })
    if (stored) { setText(''); void loadHistory() }
  }
  /** «Скрыть»: the active banner is taken down; its record stays in the history. */
  const hide = () => send({ text: saved?.text ?? '', active: false })
  const shown = Boolean(saved?.active)
  return (
    <section className="panel owner-announcement">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('Уведомление сверху · для всех игроков')}</div><div className="panel-title">{uiLabel('Баннер для всех')}</div></div>
        <Megaphone size={18} className={shown ? 'brass' : 'dim'} aria-hidden="true" />
      </div>
      <div className="panel-body owner-announcement-body">
        <textarea className="input" rows={3} maxLength={MAX} value={text} placeholder={uiLabel('Например: ведутся технические работы, приложение заработает через 15 минут.')} onChange={(event) => setText(event.target.value)} />
        <small className="owner-announcement-hint">{uiLabel(HINT)}</small>
        <div className="owner-announcement-actions">
          <button type="button" className="button small primary" disabled={busy || !text.trim()} onClick={() => void show()}>
            {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}{uiLabel(shown ? 'Показать новый всем' : 'Показать всем')}
          </button>
          <button type="button" className="button small ghost" disabled={busy || !shown} onClick={() => void hide()}>
            <EyeOff size={13} aria-hidden="true" />{uiLabel('Скрыть')}
          </button>
          <small className="dim">{text.length}/{MAX}</small>
        </div>
        <small className={shown ? 'owner-announcement-state is-on' : 'owner-announcement-state'}>{uiLabel(shown ? 'Показывается у всех.' : 'Сейчас не показывается.')} {uiLabel('Приложения игроков проверяют уведомление раз в 3–6 минут.')}</small>
        {/* The English of the active banner, to check and correct; a new save brings a new English (key). */}
        {shown && saved?.text && saved.textEn !== undefined && <EnglishVersion key={saved.updatedAt} saved={saved} busy={busy} onSave={(textEn) => send({ text: saved.text, active: saved.active, textEn })} />}
        {error && <small className="nickname-editor-error" role="alert">{uiLabel(error)}</small>}
        <BannerHistory open={showHistory} onToggle={() => setShowHistory((value) => !value)} history={history} />
      </div>
    </section>
  )
}

/** «История баннеров»: the past banners, newest first, collapsed until opened (owner, 16.10.2026). */
function BannerHistory({ open, onToggle, history }: { open: boolean; onToggle: () => void; history: HistoryEntry[] | null }) {
  return (
    <div className="owner-announcement-history">
      <button type="button" className="link-button owner-notices-toggle" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}<History size={13} aria-hidden="true" />{uiLabel('История баннеров')}{history?.length ? ` (${history.length})` : ''}
      </button>
      {open && (history === null
        ? <small className="dim">{uiLabel('Загрузка…')}</small>
        : history.length === 0
          ? <small className="dim">{uiLabel('Баннеров пока не было.')}</small>
          : <ul className="owner-announcement-history-list">
              {history.map((entry) => (
                <li key={entry.id}>
                  <small className="dim">{when(entry.updatedAt)}</small>
                  <p>{entry.text}</p>
                  {entry.textEn && <p className="owner-announcement-english-text" lang="en">{entry.textEn}</p>}
                </li>
              ))}
            </ul>)}
    </div>
  )
}

/** The English foreign players get: «Автоперевод» or «Ваш перевод», «Изменить» to correct it; a warning when there is none. */
function EnglishVersion({ saved, busy, onSave }: { saved: Saved; busy: boolean; onSave: (textEn: string) => Promise<unknown> }) {
  /** The English being corrected; null while it is only shown. */
  const [draft, setDraft] = useState<string | null>(null)
  const english = saved.textEn ?? ''
  return (
    <div className="owner-announcement-english">
      <div className="owner-announcement-english-head">
        <span>{uiLabel('Английская версия')}</span>
        {english && <span className={saved.textEnSource === 'manual' ? 'tag green' : 'tag brass'}>{uiLabel(saved.textEnSource === 'manual' ? 'Ваш перевод' : 'Автоперевод')}</span>}
        {draft === null && <button type="button" className="button small ghost" disabled={busy} onClick={() => setDraft(english)}><Pencil size={13} aria-hidden="true" />{uiLabel('Изменить')}</button>}
      </div>
      {draft === null && english && <p className="owner-announcement-english-text" lang="en">{english}</p>}
      {draft !== null && <>
        <textarea className="input" rows={3} maxLength={MAX} lang="en" aria-label={uiLabel('Английская версия')} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <div className="owner-announcement-actions">
          <button type="button" className="button small primary" disabled={busy || !draft.trim()} onClick={() => void onSave(draft.trim())}>
            {busy ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{uiLabel('Сохранить перевод')}
          </button>
          <button type="button" className="button small ghost" disabled={busy} onClick={() => setDraft(null)}>{uiLabel('Отмена')}</button>
          <small className="dim">{draft.length}/{MAX}</small>
        </div>
      </>}
      {!english && <small className="nickname-editor-error" role="alert">{uiLabel(NO_ENGLISH)}</small>}
    </div>
  )
}
