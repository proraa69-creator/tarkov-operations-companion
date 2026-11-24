import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Check, LoaderCircle, Minus, Pencil, Plus, RotateCcw, X } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { setNewsEdits, type NewsEdits } from '../news/newsEdits'
import { NEWS_GROUPS, type NewsItem, type NewsKind } from '../news/newsState'
import { errorText } from './adminFormat'
import type { AdminRequest } from './ownerAccess'
import './adminNews.css'

const PATH = '/v1/accounts/me/admin/player-news'

interface AdminNewsEntry { version: string; date: string; items: NewsItem[] }
interface AdminNewsAnswer { entries: AdminNewsEntry[]; edited: string[]; edits: NewsEdits }
type Draft = Partial<Record<NewsKind, string[]>>

const draftOf = (items: readonly NewsItem[]): Draft => {
  const draft: Draft = {}
  for (const item of items) (draft[item.kind] ??= []).push(item.ru)
  return draft
}

const dayOf = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('ru', { day: 'numeric', month: 'long' })

/** One point: Enter makes the next one (also when a phone's keyboard only inserts a line, or a list is pasted), Backspace on an empty one takes it away. */
function PointInput({ value, focused, onFocused, onChange, onLines, onRemove }: { value: string; focused: boolean; onFocused: () => void; onChange: (value: string) => void; onLines: (lines: string[]) => void; onRemove: () => void }) {
  const box = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [value])
  useEffect(() => {
    if (!focused) return
    const element = box.current
    element?.focus()
    element?.setSelectionRange(element.value.length, element.value.length)
    onFocused()
  }, [focused, onFocused])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Backspace' && !value) { event.preventDefault(); onRemove() }
  }
  return <li className="admin-news-point">
    <textarea
      ref={box}
      className="input"
      rows={1}
      value={value}
      aria-label={uiLabel('Текст пункта')}
      onKeyDown={onKeyDown}
      onChange={(event) => {
        const lines = event.target.value.split(/\r?\n/)
        if (lines.length > 1) onLines(lines)
        else onChange(lines[0]!)
      }}
    />
    <button type="button" className="admin-news-remove" aria-label={uiLabel('Убрать пункт')} title={uiLabel('Убрать пункт')} onClick={onRemove}><X size={13} aria-hidden="true" /></button>
  </li>
}

/**
 * A release opened for editing (owner, 06.11.2026: «возле них будет минус, это удалить. Если какого-то блока нету, я могу его добавить…
 * И проверяется оно между добавили и улучшили. То есть всегда должно быть одинаковый порядок… нажал Enter, и у меня появляется новая
 * точка»). The order of the blocks is NEWS_GROUPS', whatever order they were added in.
 */
function EntryEditor({ entry, edited, request, onSaved, onCancel }: { entry: AdminNewsEntry; edited: boolean; request: AdminRequest; onSaved: (answer: AdminNewsAnswer) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(entry.items))
  const [focus, setFocus] = useState<{ kind: NewsKind; index: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clearFocus = useCallback(() => setFocus(null), [])
  const setLines = (kind: NewsKind, lines: string[]) => setDraft((current) => ({ ...current, [kind]: lines }))
  const missing = NEWS_GROUPS.filter(({ kind }) => !draft[kind])

  const send = (method: 'PUT' | 'POST', path: string, body: unknown) => {
    setBusy(true)
    setError('')
    request(method, path, body).then((answer) => onSaved(answer as AdminNewsAnswer), (reason: unknown) => { setError(errorText(reason)); setBusy(false) })
  }
  const save = () => {
    const items = NEWS_GROUPS.flatMap(({ kind }) => (draft[kind] ?? []).map((ru) => ru.trim()).filter(Boolean).map((ru) => ({ kind, ru })))
    send('PUT', PATH, { version: entry.version, items })
  }

  return <div className="admin-news-editor">
    {NEWS_GROUPS.map(({ kind, title }) => {
      const lines = draft[kind]
      if (!lines) return null
      return <section key={kind} className="admin-news-block">
        <header>
          <h4>{uiLabel(title)}</h4>
          <button type="button" className="icon-button" aria-label={`${uiLabel('Убрать блок')} ${uiLabel(title)}`} title={uiLabel('Убрать блок')} onClick={() => setDraft((current) => { const next = { ...current }; delete next[kind]; return next })}><Minus size={15} aria-hidden="true" /></button>
        </header>
        <ul>
          {lines.map((line, index) => <PointInput
            key={index}
            value={line}
            focused={focus?.kind === kind && focus.index === index}
            onFocused={clearFocus}
            onChange={(value) => setLines(kind, lines.map((old, at) => (at === index ? value : old)))}
            onLines={(parts) => {
              setLines(kind, [...lines.slice(0, index), ...parts, ...lines.slice(index + 1)])
              setFocus({ kind, index: index + parts.length - 1 })
            }}
            onRemove={() => {
              const rest = lines.filter((_, at) => at !== index)
              setLines(kind, rest.length ? rest : [''])
              setFocus({ kind, index: Math.max(0, index - 1) })
            }}
          />)}
        </ul>
      </section>
    })}
    {missing.length > 0 && <div className="admin-news-add">
      {missing.map(({ kind, title }) => <button key={kind} type="button" className="button small ghost" onClick={() => { setLines(kind, ['']); setFocus({ kind, index: 0 }) }}><Plus size={14} aria-hidden="true" />{uiLabel(title)}</button>)}
    </div>}
    {error && <p className="admin-news-error" role="alert">{uiLabel(error)}</p>}
    <div className="admin-news-actions">
      <button type="button" className="button small primary" disabled={busy} onClick={save}>{busy ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{uiLabel('Сохранить')}</button>
      <button type="button" className="button small ghost" disabled={busy} onClick={onCancel}>{uiLabel('Отмена')}</button>
      {edited && <button type="button" className="button small ghost" disabled={busy} onClick={() => send('POST', `${PATH}/reset`, { version: entry.version })}><RotateCcw size={14} aria-hidden="true" />{uiLabel('Вернуть как было')}</button>}
    </div>
  </div>
}

/**
 * «Обновление» of the admin apps, on the PC and on the phone: the releases as players read them, and «Редактировать» on each.
 * «Сохранить» sends the text to the server, and from there to everybody (server/src/routes/playerNews.ts).
 */
export function AdminNewsEditor({ request }: { request: AdminRequest }) {
  const [answer, setAnswer] = useState<AdminNewsAnswer | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    request('GET', PATH).then(
      (next) => { if (alive) setAnswer(next as AdminNewsAnswer) },
      (reason: unknown) => { if (alive) setError(errorText(reason)) },
    )
    return () => { alive = false }
  }, [request])

  if (error) return <p className="admin-news-error" role="alert">{uiLabel(error)}</p>
  if (!answer) return <p className="dim">{uiLabel('Загружаем…')}</p>
  return <ul className="admin-news">
    {answer.entries.map((entry) => {
      const open = editing === entry.version
      const edited = answer.edited.includes(entry.version)
      return <li key={entry.version} className="admin-news-entry">
        <header>
          <strong>{entry.version}</strong>
          <small>{dayOf(entry.date)}</small>
          {edited && <span className="tag brass">{uiLabel('Ваш текст')}</span>}
          {saved === entry.version && !open && <span className="tag green"><Check size={11} aria-hidden="true" />{uiLabel('Сохранено')}</span>}
          {!open && <button type="button" className="button small" onClick={() => { setEditing(entry.version); setSaved(null) }}><Pencil size={13} aria-hidden="true" />{uiLabel('Редактировать')}</button>}
        </header>
        {open
          ? <EntryEditor
              entry={entry}
              edited={edited}
              request={request}
              onCancel={() => setEditing(null)}
              onSaved={(next) => { setAnswer(next); setNewsEdits(next.edits); setEditing(null); setSaved(entry.version) }}
            />
          : NEWS_GROUPS.map(({ kind, title }) => {
            const items = entry.items.filter((item) => item.kind === kind)
            return items.length > 0 && <section key={kind} className="admin-news-read">
              <h4>{uiLabel(title)}</h4>
              <ul>{items.map((item, index) => <li key={index}>{item.ru}</li>)}</ul>
            </section>
          })}
      </li>
    })}
  </ul>
}

/** The phone: in its own window, as «История обновлений». */
export function AdminNewsSheet({ request, onClose }: { request: AdminRequest; onClose: () => void }) {
  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet admin-wide-sheet" role="dialog" aria-modal="true" aria-label={uiLabel('Обновление')}>
      <header className="admin-sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label={uiLabel('Назад')}><ArrowLeft size={18} /></button><strong>{uiLabel('Обновление')}</strong></header>
      <div className="admin-sheet-scroll"><AdminNewsEditor request={request} /></div>
    </section>
  </div>
}
