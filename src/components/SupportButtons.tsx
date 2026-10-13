import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Bug, CheckCircle2, CircleHelp, CreditCard, Crosshair, Download, Gauge, Gift, House, ImagePlus, Info, Languages, Lightbulb, LoaderCircle, LogIn, Map as MapIcon, MapPinned, MessageCircle, Package, RefreshCw, ScrollText, Send, ShoppingCart, Skull, Store, User, Users, Wrench, X, type LucideIcon } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useOptionalAppState } from '../state/AppState'
import { useOptionalTarkovData } from '../data/DataProvider'
import { QUEST_ISSUE_LABELS, REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, type ReportCategory } from '../shared/reportCategories'
import { QuestReportSection, questReportHasContent, questReportPayload, type QuestReportDraft } from './QuestReportSection'
import { useAppVersion } from '../app/appVersion'
import { appEdition } from '../app/buildEdition'
import { isDesktopShell, isNative, nativePlatform } from '../platform'
import { useTarkovEdition, type TarkovEdition } from '../import/logStatus'
import { LOG_FOLDER_STORAGE_KEY } from '../import/logApply'
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

/** The reward the owner grants by hand after checking a report (website «Админ-панель» → «Отчёты»; owner, 11.10.2026). */
export const REWARD_NOTE = 'Если ошибка подтвердится, к подписке добавится 1 день.'

/** 'bug': «Сообщить об ошибке»; 'idea': «Ваши предложения» (owner, 13.10.2026). Both go to POST /v1/bug-reports. */
export type ReportKind = 'bug' | 'idea'

/** The dialog's words for each kind (Russian keys of uiText, English in src/i18n/uiEnglishSupport.ts). */
const WORDS: Record<ReportKind, Record<'title' | 'topic' | 'description' | 'drop' | 'files' | 'remove' | 'tooBig' | 'tooMany' | 'meta' | 'send' | 'sent' | 'sentNote' | 'signIn' | 'signInFirst' | 'appOnly', string>> = {
  bug: {
    title: 'Сообщить об ошибке',
    topic: 'Коротко: что сломалось',
    description: 'Что вы делали, что ожидали и что произошло',
    drop: 'Перетащите скриншоты сюда, вставьте из буфера (Ctrl+V) или',
    files: 'Скриншоты',
    remove: 'Убрать скриншот',
    tooBig: 'Каждый скриншот — не больше 5 МБ.',
    tooMany: 'Не больше 5 скриншотов.',
    meta: 'К отчёту автоматически добавятся:',
    send: 'Отправить отчёт',
    sent: 'Спасибо! Отчёт отправлен',
    sentNote: 'Мы посмотрим его и постараемся исправить. Если нужно что-то уточнить — пишите в Telegram.',
    signIn: 'Отчёт об ошибке можно отправить после входа в аккаунт: так мы сможем ответить вам. Без входа напишите нам в Telegram.',
    signInFirst: 'Войдите в аккаунт, чтобы отправить отчёт об ошибке.',
    appOnly: 'Отправка отчётов работает в приложении. Напишите нам в Telegram.',
  },
  idea: {
    title: 'Ваши предложения',
    topic: 'Коротко: ваша идея',
    description: 'Что добавить или изменить в приложении и чем это поможет',
    drop: 'Перетащите фото сюда, вставьте из буфера (Ctrl+V) или',
    files: 'Фото',
    remove: 'Убрать фото',
    tooBig: 'Каждое фото — не больше 5 МБ.',
    tooMany: 'Не больше 5 фото.',
    meta: 'К предложению автоматически добавятся:',
    send: 'Отправить предложение',
    sent: 'Спасибо! Предложение отправлено',
    sentNote: 'Мы обязательно его прочитаем. Если захотите что-то добавить — пишите в Telegram.',
    signIn: 'Предложение можно отправить после входа в аккаунт: так мы сможем ответить вам. Без входа напишите нам в Telegram.',
    signInFirst: 'Войдите в аккаунт, чтобы отправить предложение.',
    appOnly: 'Отправка предложений работает в приложении. Напишите нам в Telegram.',
  },
}

/** «Версия Таркова» in the report (owner, 13.10.2026: «какая версия таркова, стим или не стим»). */
const TARKOV_EDITION_LABELS: Record<TarkovEdition, string> = {
  steam: 'Steam',
  launcher: 'не Steam (лаунчер BSG)',
  'not-found': 'не определена — журналы игры не найдены',
}
const TARKOV_EDITION_SHORT: Record<TarkovEdition, string> = { steam: 'Steam', launcher: 'BSG launcher', 'not-found': 'logs not found' }
const savedLogsFolder = () => { try { return localStorage.getItem(LOG_FOLDER_STORAGE_KEY) } catch { return null } }

/** The phone app names its system, the desktop app its build («client» / «owner»). */
function editionLabel() {
  if (!isNative()) return appEdition()
  return nativePlatform() === 'ios' ? 'iPhone' : nativePlatform() === 'android' ? 'Android' : 'phone'
}

const CATEGORY_ICONS: Record<ReportCategory, LucideIcon> = {
  quest: ScrollText, map: MapIcon, minimap: MapPinned, progress: RefreshCw, kappa: Package, 'item-info': Info, bosses: Skull,
  traders: Store, flea: ShoppingCart, hideout: House, gunsmith: Wrench, ballistics: Crosshair, squad: Users, account: User,
  subscription: CreditCard, update: Download, performance: Gauge, interface: Languages, other: CircleHelp,
}

/**
 * «Сообщить об ошибке» and «Ваши предложения» (owner, 13.10.2026: «там люди могут предложить свои идеи для приложения и
 * отправить фото»): topic, description, up to five images (file picker, drag & drop, Ctrl+V). On top of a bug report:
 * «Нашёл баг или ошибку? +1 день» (owner, 11.10.2026); of an idea, what to write. The server forwards every one to the
 * owner as a PDF.
 *
 * A bug report starts with its category (owner, 13.10.2026: «сделай окно, которое раскладывается и прокручивается вверх
 * низ, там должна быть категория бага, типо квест, функция итд»): the form unfolds under the chosen one, and «Квест»
 * adds the quest search, what is wrong, the quest's map to mark the wrong point and the right place, and notes
 * (components/QuestReportSection.tsx).
 */
export function ReportDialog({ kind, onClose }: { kind: ReportKind; onClose: () => void }) {
  const words = WORDS[kind]
  const { status, checking } = useServerAccount()
  const raidMode = useOptionalAppState()?.raidMode ?? 'pvp'
  const quests = useOptionalTarkovData()?.data.quests
  const [category, setCategory] = useState<ReportCategory | ''>('')
  const [questDraft, setQuestDraft] = useState<QuestReportDraft | null>(null)
  /** The topic the window wrote itself for the chosen quest (a topic the player typed is never replaced). */
  const [autoTopic, setAutoTopic] = useState('')
  const version = useAppVersion()
  const signedIn = Boolean(status?.signedIn)
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [contact, setContact] = useState(false)
  const closeContact = useCallback(() => setContact(false), [])
  const fileInput = useRef<HTMLInputElement>(null)
  const shotsRef = useRef(shots)
  useEffect(() => { shotsRef.current = shots }, [shots])
  const appVersion = `${version} · ${editionLabel()}`
  // The game runs on the PC only: the phone has no Tarkov to tell.
  const edition = useTarkovEdition(savedLogsFolder)
  const gameEdition = isDesktopShell() ? edition : null
  const platform = gameEdition ? `${describePlatform()} · EFT: ${TARKOV_EDITION_SHORT[gameEdition]}` : describePlatform()

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
      if (file.size > BUG_REPORT_LIMITS.fileBytes) { problems.add(words.tooBig); continue }
      if (room <= 0) { problems.add(words.tooMany); continue }
      try {
        accepted.push({ id: nextShotId++, name: file.name || (kind === 'idea' ? 'photo.png' : 'screenshot.png'), type: file.type, size: file.size, dataUrl: await readDataUrl(file) })
        room -= 1
      } catch {
        problems.add('Не удалось прочитать файл.')
      }
    }
    if (accepted.length) setShots((current) => [...current, ...accepted].slice(0, BUG_REPORT_LIMITS.files))
    setError([...problems].map((text) => uiText(text)).join(' '))
  }, [kind, words])

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

  const isBug = kind === 'bug'
  const questReport = isBug && category === 'quest' && questDraft ? questDraft : null
  // A quest correction (a place, a wrong point or a note) is a report on its own; anything else needs a description.
  const needsDescription = !questReportHasContent(questReport)
  const ready = Boolean(topic.trim()) && (!needsDescription || Boolean(description.trim())) && (!isBug || Boolean(category))
  const changeQuest = (draft: QuestReportDraft | null) => {
    setQuestDraft(draft)
    const quest = draft ? quests?.find((entry) => entry.id === draft.questId) : undefined
    if (!quest || !draft || (topic.trim() && topic !== autoTopic)) return
    const next = `${uiText('Квест')} «${uiText(quest.name)}»: ${uiText(QUEST_ISSUE_LABELS[draft.issue]).toLowerCase()}`.slice(0, BUG_REPORT_LIMITS.topic)
    setTopic(next)
    setAutoTopic(next)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (isBug && !category) { setError(uiText('Выберите, где проблема.')); return }
    if (!topic.trim() || (needsDescription && !description.trim())) { setError(uiText('Заполните тему и описание.')); return }
    const request = serviceClient()
    if (!request) { setError(uiText(words.appOnly)); return }
    setSending(true)
    setError('')
    try {
      const answer = await request('POST', '/v1/bug-reports', {
        kind, ...(isBug && category ? { category } : {}), ...(questReport ? { quest: questReportPayload(questReport, raidMode) } : {}),
        topic: topic.trim(), description: description.trim(), appVersion, platform, screenshots: shots.map((shot) => ({ data: shot.dataUrl })),
      })
      if (!answer) { setError(uiText(words.signInFirst)); return }
      setSent(true)
    } catch (reason) {
      setError(uiText(cleanIpcError(reason)))
    } finally {
      setSending(false)
    }
  }

  // Rendered into <body>: the sidebar it is opened from clips and positions fixed children (it was drawn inside it).
  return createPortal(<div className="registration-overlay support-overlay" role="dialog" aria-modal="true" aria-label={uiText(words.title)} onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section className={`panel registration-dialog bug-report-dialog${category === 'quest' && !sent ? ' is-wide' : ''}`} onMouseDown={(event) => event.stopPropagation()} onPaste={onPaste}>
      <button type="button" className="registration-close" onClick={onClose} disabled={sending} aria-label={uiText('Закрыть')}><X size={18} /></button>
      <div className={`registration-icon${kind === 'idea' ? ' idea-icon' : ''}`}>{kind === 'idea' ? <Lightbulb size={26} /> : <Bug size={26} />}</div>
      <h2>{uiText(words.title)}</h2>
      {!sent && (kind === 'idea' ? <div className="bug-report-reward idea-intro">
        <Lightbulb size={20} aria-hidden="true" />
        <div><strong>{uiText('Есть идея для Raid OS?')}</strong><span>{uiText('Расскажите, что добавить или изменить. Можно приложить фото или скриншоты.')}</span></div>
      </div> : <div className="bug-report-reward">
        <Gift size={20} aria-hidden="true" />
        <div><strong>{uiText('Нашёл баг или ошибку?')} <b>{uiText('+1 день')}</b></strong><span>{uiText(REWARD_NOTE)}</span></div>
      </div>)}
      {sent ? <div className="bug-report-done" role="status">
        <CheckCircle2 size={34} />
        <strong>{uiText(words.sent)}</strong>
        <p className="muted">{uiText(words.sentNote)}</p>
        {kind === 'bug' && <p className="bug-report-reward-note"><Gift size={14} aria-hidden="true" />{uiText(REWARD_NOTE)}</p>}
        <div className="bug-report-actions">
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{SUPPORT_TELEGRAM_HANDLE}</a>
          <button type="button" className="button primary" onClick={onClose}>{uiText('Готово')}</button>
        </div>
      </div> : !signedIn ? <div className="bug-report-signin">
        <p className="muted">{uiText(checking && !status ? 'Проверяем аккаунт…' : words.signIn)}</p>
        <div className="bug-report-actions">
          <a className="button ghost" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} />{uiText('Написать в Telegram')}</a>
          <button type="button" className="button primary" onClick={() => { onClose(); openAccountSignIn('login') }}><LogIn size={15} />{uiText('Войти')}</button>
        </div>
      </div> : <form className="bug-report-form" onSubmit={(event) => void submit(event)}>
        {isBug && (
          <fieldset className="bug-report-categories" disabled={sending}>
            <legend>{uiText('Где проблема?')}</legend>
            <div className="bug-report-category-grid" role="radiogroup" aria-label={uiText('Где проблема?')}>
              {REPORT_CATEGORIES.map((entry) => {
                const Icon = CATEGORY_ICONS[entry]
                return (
                  <button key={entry} type="button" role="radio" aria-checked={category === entry} className={`bug-report-chip${category === entry ? ' active' : ''}`} onClick={() => { setCategory(entry); setError('') }}>
                    <Icon size={14} aria-hidden="true" />{uiText(REPORT_CATEGORY_LABELS[entry])}
                  </button>
                )
              })}
            </div>
          </fieldset>
        )}
        <div className={`bug-report-expand${!isBug || category ? ' is-open' : ''}`} inert={isBug && !category}>
        <div className="bug-report-expand-body">
        {category === 'quest' && <QuestReportSection value={questDraft} onChange={changeQuest} disabled={sending} />}
        <label className="field-label">{uiText('Тема')}
          <input className="input" value={topic} maxLength={BUG_REPORT_LIMITS.topic} required disabled={sending} onChange={(event) => setTopic(event.target.value)} placeholder={uiText(words.topic)} />
        </label>
        <label className="field-label">{uiText('Описание')}
          <textarea className="input bug-report-text" value={description} maxLength={BUG_REPORT_LIMITS.description} required={needsDescription} disabled={sending} rows={category === 'quest' ? 3 : 6} onChange={(event) => setDescription(event.target.value)} placeholder={uiText(category === 'quest' && !needsDescription ? 'Можно добавить подробности (необязательно)' : words.description)} />
          <small className="bug-report-count">{description.length} / {BUG_REPORT_LIMITS.description}</small>
        </label>
        <div
          className={`bug-report-drop${dragging ? ' dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <ImagePlus size={18} />
          <span>{uiText(words.drop)}</span>
          <button type="button" className="button small ghost" disabled={sending || shots.length >= BUG_REPORT_LIMITS.files} onClick={() => fileInput.current?.click()}>{uiText('выберите файлы')}</button>
          <input ref={fileInput} type="file" hidden multiple accept="image/png,image/jpeg,image/webp" aria-label={uiText(words.files)} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          <small>{uiText('До 5 изображений PNG, JPEG или WEBP, каждое до 5 МБ.')}</small>
        </div>
        {shots.length > 0 && <ul className="bug-report-shots">
          {shots.map((shot) => <li key={shot.id}>
            <img src={shot.dataUrl} alt={shot.name} />
            <small title={shot.name}>{sizeText(shot.size)}</small>
            <button type="button" disabled={sending} onClick={() => setShots((current) => current.filter((entry) => entry.id !== shot.id))} aria-label={`${uiText(words.remove)} ${shot.name}`}><X size={13} /></button>
          </li>)}
        </ul>}
        <div className="bug-report-meta">
          <strong>{uiText(words.meta)}</strong>
          <span>{uiText('Версия приложения')}: {appVersion}</span>
          <span>{uiText('Система')}: {describePlatform()}</span>
          {gameEdition && <span>{uiText('Версия Таркова')}: {uiText(TARKOV_EDITION_LABELS[gameEdition])}</span>}
          {status?.email && <span>{uiText('Аккаунт')}: {status.email}</span>}
        </div>
        </div>
        </div>
        {error && <div className="import-warning" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        <div className="bug-report-actions">
          <button type="button" className="button ghost" onClick={() => setContact(true)}><MessageCircle size={15} />{uiText('Связаться')}</button>
          <button type="submit" className="button primary" disabled={sending || !ready}>
            {sending ? <LoaderCircle className="spin" size={16} /> : <Send size={15} />}{uiText(sending ? 'Отправляем…' : words.send)}
          </button>
        </div>
      </form>}
      {contact && <ContactDialog onClose={closeContact} />}
    </section>
  </div>, document.body)
}

/**
 * «Связаться» (owner, 12.10.2026: «при нажатии всплывающее окно, и предлагает перейти в телеграм канал для связи. кнопки
 * да нет»): «Да» opens the Telegram channel (the system browser, as every outside link), «Нет» closes.
 */
export function ContactDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    // Captured on the window: over the bug report dialog, Escape closes only this one.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return createPortal(<div className="registration-overlay support-overlay" role="dialog" aria-modal="true" aria-label={uiText('Связаться с нами')} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel registration-dialog contact-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      <div className="registration-icon"><MessageCircle size={26} /></div>
      <h2>{uiText('Связаться с нами')}</h2>
      <p className="muted">{uiText('Перейти в Telegram-канал Raid OS, чтобы написать нам?')} <strong className="contact-handle">{SUPPORT_TELEGRAM_HANDLE}</strong></p>
      <div className="contact-actions">
        <button type="button" className="button ghost" onClick={onClose}>{uiText('Нет')}</button>
        {/* Closed after the click: the link opens first. */}
        <a className="button primary" href={SUPPORT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer" autoFocus onClick={() => window.setTimeout(onClose, 0)}><Send size={15} />{uiText('Да')}</a>
      </div>
    </section>
  </div>, document.body)
}

/**
 * «Связаться» (asks, then Telegram), «Сообщить об ошибке» and under it «Ваши предложения» (owner, 13.10.2026): in the
 * sidebar's «Система» group (`variant="nav"`) and in Settings → «Поддержка» (`variant="panel"`, also on the phone, which
 * has no sidebar).
 */
export function SupportButtons({ variant }: { variant: 'nav' | 'panel' }) {
  const [open, setOpen] = useState<'' | 'contact' | ReportKind>('')
  const close = useCallback(() => setOpen(''), [])
  const className = variant === 'nav' ? 'nav-link support-nav-link' : 'button ghost'
  const icon = variant === 'nav' ? undefined : 15
  return <>
    <button type="button" className={className} onClick={() => setOpen('contact')} title={`Telegram ${SUPPORT_TELEGRAM_HANDLE}`}><MessageCircle size={icon} /><span>{uiText('Связаться')}</span></button>
    <button type="button" className={className} onClick={() => setOpen('bug')}><Bug size={icon} /><span>{uiText('Сообщить об ошибке')}</span></button>
    <button type="button" className={className} onClick={() => setOpen('idea')}><Lightbulb size={icon} /><span>{uiText('Ваши предложения')}</span></button>
    {open === 'contact' && <ContactDialog onClose={close} />}
    {(open === 'bug' || open === 'idea') && <ReportDialog key={open} kind={open} onClose={close} />}
  </>
}
