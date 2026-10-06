import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { AlertTriangle, Bug, CheckCircle2, ImagePlus, LoaderCircle, LogIn, MessageCircle, Send, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppVersion } from '../app/appVersion'
import { appEdition } from '../app/buildEdition'
import { BUG_REPORT_LIMITS, describePlatform, IMAGE_TYPES, SUPPORT_TELEGRAM_HANDLE, SUPPORT_TELEGRAM_URL } from '../app/support'
import { cleanIpcError, useServerAccount } from '../sync/serverSync'
import { serviceClient } from '../account/nicknameBinding'
import { openAccountSignIn } from '../account/accountEvents'
import '../styles/support.css'

interface Shot { id: number; name: string; type: string; size: number; dataUrl: string }

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error ?? new Error('read failed'))
  reader.readAsDataURL(file)
})

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

let nextShotId = 1

/** «Сообщить об ошибке»: topic, description, up to five screenshots (file picker, drag & drop, Ctrl+V). */
export function BugReportDialog({ onClose }: { onClose: () => void }) {
  const { status, checking } = useServerAccount()
  const version = useAppVersion()
  const signedIn = Boolean(status?.signedIn)
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const shotsRef = useRef(shots)
  useEffect(() => { shotsRef.current = shots }, [shots])
  const appVersion = `${version} · ${appEdition()}`
  const platform = describePlatform()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    const problems = new Set<string>()
    const accepted: Shot[] = []
    let room = BUG_REPORT_LIMITS.files - shotsRef.current.length
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) { problems.add('Можно прикрепить только PNG, JPEG или WEBP.'); continue }
      if (file.size > BUG_REPORT_LIMITS.fileBytes) { problems.add('Каждый скриншот — не больше 5 МБ.'); continue }
      if (room <= 0) { problems.add('Не больше 5 скриншотов.'); continue }
      try {
        accepted.push({ id: nextShotId++, name: file.name || 'screenshot.png', type: file.type, size: file.size, dataUrl: await readDataUrl(file) })
        room -= 1
      } catch {
        problems.add('Не удалось прочитать файл.')
      }
    }
    if (accepted.length) setShots((current) => [...current, ...accepted].slice(0, BUG_REPORT_LIMITS.files))
    setError([...problems].map((text) => uiText(text)).join(' '))
  }, [])

  const onPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))
    if (!files.length) return
    event.preventDefault()
    void addFiles(files)
  }
  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void addFiles(Array.from(event.dataTransfer?.files ?? []))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!topic.trim() || !description.trim()) { setError(uiText('Заполните тему и описание.')); return }
    const request = serviceClient()
    if (!request) { setError(uiText('Отправка отчётов работает в приложении. Напишите нам в Telegram.')); return }
    setSending(true)
    setError('')
    try {
      const answer = await request('POST', '/v1/bug-reports', { topic: topic.trim(), description: description.trim(), appVersion, platform, screenshots: shots.map((shot) => ({ data: shot.dataUrl })) })
      if (!answer) { setError(uiText('Войдите в аккаунт, чтобы отправить отчёт об ошибке.')); return }
      setSent(true)
    } catch (reason) {
      setError(uiText(cleanIpcError(reason)))
    } finally {
      setSending(false)
    }
  }

  return <div className="registration-overlay support-overlay" role="dialog" aria-modal="true" aria-label={uiText('Сообщить об ошибке')} onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section className="panel registration-dialog bug-report-dialog" onMouseDown={(event) => event.stopPropagation()} onPaste={onPaste}>
      <button type="button" className="registration-close" onClick={onClose} disabled={sending} aria-label={uiText('Закрыть')}><X size={18} /></button>
      <div className="registration-icon"><Bug size={26} /></div>
      <h2>{uiText('Сообщить об ошибке')}</h2>
      {sent ? <div className="bug-report-done" role="status">
        <CheckCircle2 size={34} />
        <strong>{uiText('Спасибо! Отчёт отправлен')}</strong>
        <p className="muted">{uiText('Мы посмотрим его и постараемся исправить. Если нужно что-то уточнить — пишите в Telegram.')}</p>
        <div className="bug-report-actions">
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{SUPPORT_TELEGRAM_HANDLE}</a>
          <button type="button" className="button primary" onClick={onClose}>{uiText('Готово')}</button>
        </div>
      </div> : !signedIn ? <div className="bug-report-signin">
        <p className="muted">{uiText(checking && !status ? 'Проверяем аккаунт…' : 'Отчёт об ошибке можно отправить после входа в аккаунт: так мы сможем ответить вам. Без входа напишите нам в Telegram.')}</p>
        <div className="bug-report-actions">
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{uiText('Написать в Telegram')}</a>
          <button type="button" className="button primary" onClick={() => { onClose(); openAccountSignIn('login') }}><LogIn size={15} />{uiText('Войти')}</button>
        </div>
      </div> : <form className="bug-report-form" onSubmit={(event) => void submit(event)}>
        <label className="field-label">{uiText('Тема')}
          <input className="input" value={topic} maxLength={BUG_REPORT_LIMITS.topic} required disabled={sending} onChange={(event) => setTopic(event.target.value)} placeholder={uiText('Коротко: что сломалось')} />
        </label>
        <label className="field-label">{uiText('Описание')}
          <textarea className="input bug-report-text" value={description} maxLength={BUG_REPORT_LIMITS.description} required disabled={sending} rows={6} onChange={(event) => setDescription(event.target.value)} placeholder={uiText('Что вы делали, что ожидали и что произошло')} />
          <small className="bug-report-count">{description.length} / {BUG_REPORT_LIMITS.description}</small>
        </label>
        <div
          className={`bug-report-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <ImagePlus size={18} />
          <span>{uiText('Перетащите скриншоты сюда, вставьте из буфера (Ctrl+V) или')}</span>
          <button type="button" className="button small ghost" disabled={sending || shots.length >= BUG_REPORT_LIMITS.files} onClick={() => fileInput.current?.click()}>{uiText('выберите файлы')}</button>
          <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label={uiText('Скриншоты')} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          <small>{uiText('До 5 изображений PNG, JPEG или WEBP, каждое до 5 МБ.')}</small>
        </div>
        {shots.length > 0 && <ul className="bug-report-shots">
          {shots.map((shot) => <li key={shot.id}>
            <img src={shot.dataUrl} alt={shot.name} />
            <small title={shot.name}>{sizeText(shot.size)}</small>
            <button type="button" disabled={sending} onClick={() => setShots((current) => current.filter((entry) => entry.id !== shot.id))} aria-label={`${uiText('Убрать скриншот')} ${shot.name}`}><X size={13} /></button>
          </li>)}
        </ul>}
        <div className="bug-report-meta">
          <strong>{uiText('К отчёту автоматически добавятся:')}</strong>
          <span>{uiText('Версия приложения')}: {appVersion}</span>
          <span>{uiText('Система')}: {platform}</span>
          {status?.email && <span>{uiText('Аккаунт')}: {status.email}</span>}
        </div>
        {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        <div className="bug-report-actions">
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{uiText('Связаться')}</a>
          <button type="submit" className="button primary" disabled={sending || !topic.trim() || !description.trim()}>
            {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}{uiText(sending ? 'Отправляем…' : 'Отправить отчёт')}
          </button>
        </div>
      </form>}
    </section>
  </div>
}

/**
 * «Связаться» (Telegram) and «Сообщить об ошибке»: in the sidebar's «Система» group (`variant="nav"`) and in
 * Settings → «Поддержка» (`variant="panel"`, also on the phone, which has no sidebar).
 */
export function SupportButtons({ variant }: { variant: 'nav' | 'panel' }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const className = variant === 'nav' ? 'nav-link support-nav-link' : 'button ghost'
  return <>
    <a className={className} href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" title={`Telegram ${SUPPORT_TELEGRAM_HANDLE}`}><MessageCircle size={variant === 'nav' ? undefined : 15} /><span>{uiText('Связаться')}</span></a>
    <button type="button" className={className} onClick={() => setOpen(true)}><Bug size={variant === 'nav' ? undefined : 15} /><span>{uiText('Сообщить об ошибке')}</span></button>
    {open && <BugReportDialog onClose={close} />}
  </>
}
