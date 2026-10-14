import { useEffect, useState } from 'react'
import { Check, Eye, EyeOff, LoaderCircle, Megaphone, Pencil } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { setAnnouncement } from './announcement'

const MAX = 500
const PATH = '/v1/accounts/me/admin/announcement'
/** Under the Russian field (server/src/services/announcementLanguage.ts). */
const HINT = 'Пишите по-русски. Игроки из СНГ и из неизвестных стран видят этот текст, остальные — английский перевод, он делается сам.'
const NO_ENGLISH = 'Перевод не получился — иностранцы видят русский текст. Впишите английский вручную.'

/**
 * The notice as the server keeps it: the owner's Russian and the English every other country reads (null: none, they
 * read the Russian; absent: a server from before the English).
 */
interface Saved { text: string; textEn?: string | null; textEnSource?: 'auto' | 'manual' | null; active: boolean; updatedAt: string }

/**
 * The owner app: «Уведомление сверху». The text appears at the top of every player's app within a few minutes («Показать
 * всем») and stays until «Скрыть» (server/src/routes/announcement.ts; the apps check every 3–6 minutes). The owner writes
 * Russian; foreign players get the English made at the save (owner, 14.10.2026: «все кто с снг уведомление будет на
 * русском и не известные страны тоже на русском, а все иностранные у них этот текст будет автоматически переводится на
 * английский»), shown under it to be checked and corrected.
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

  /** `textEn`: the owner's own English, instead of the automatic one. */
  const send = async (body: { text: string; active: boolean; textEn?: string }) => {
    setBusy(true)
    setError('')
    try {
      const answer = await request('PUT', PATH, body) as { announcement?: Saved } | null
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
  const save = (active: boolean) => send({ text: text.trim(), active })
  const shown = Boolean(saved?.active)
  return (
    <section className="panel owner-announcement">
      <div className="panel-header">
        <div><div className="eyebrow">{uiLabel('Для всех игроков')}</div><div className="panel-title">{uiLabel('Уведомление сверху')}</div></div>
        <Megaphone size={18} className={shown ? 'brass' : 'dim'} aria-hidden="true" />
      </div>
      <div className="panel-body owner-announcement-body">
        <textarea className="input" rows={3} maxLength={MAX} value={text} placeholder={uiLabel('Например: ведутся технические работы, приложение заработает через 15 минут.')} onChange={(event) => setText(event.target.value)} />
        <small className="owner-announcement-hint">{uiLabel(HINT)}</small>
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
        {/* A new save brings a new English: the editor starts over (key). The stored Russian and visibility stay. */}
        {saved?.text && saved.textEn !== undefined && <EnglishVersion key={saved.updatedAt} saved={saved} busy={busy} onSave={(textEn) => send({ text: saved.text, active: saved.active, textEn })} />}
        {error && <small className="nickname-editor-error" role="alert">{uiLabel(error)}</small>}
      </div>
    </section>
  )
}

/** The English foreign players get: «Автоперевод» or «Ваш перевод», «Изменить» to correct it; a warning when there is none. */
function EnglishVersion({ saved, busy, onSave }: { saved: Saved; busy: boolean; onSave: (textEn: string) => Promise<void> }) {
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
