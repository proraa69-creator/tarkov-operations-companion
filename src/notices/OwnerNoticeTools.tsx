import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ClipboardList, ExternalLink, ImagePlus, Languages, LoaderCircle, Megaphone, Plus, RotateCcw, Send, Trash2, Undo2, X } from 'lucide-react'
import { audienceText, NOTICE_LIMITS, NOTICE_REGIONS, PAYMENT_NAMES, REGION_NAMES, SURVEY_LIMITS, type NoticeAudience, type NoticePayment, type NoticeRegion, type SurveyQuestion, type SurveyQuestionType } from '../shared/notices'
import { NOTICE_IMAGE_TYPES, prepareNoticeImage } from './imageResize'
import { surveyDraftProblem } from './surveyRules'
import './ownerNotices.css'

/** The owner's API call: the app's gateway (serviceRequest) or the website's fetch with the owner's session. */
export type OwnerRequest = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>
type T = (ru: string) => string

/** A sent announcement or survey as the server lists it (server/src/services/noticeStore.ts OwnerNotice). */
export interface OwnerNoticeView {
  id: number
  kind: 'announcement' | 'survey'
  title: string
  titleEn?: string
  text: string
  textEn?: string
  button?: { text: string; textEn?: string; url: string }
  questions?: SurveyQuestion[]
  images: number
  audience: NoticeAudience
  createdAt: string
  withdrawnAt?: string
  targeted: number
  seen: number
  closed: number
  responses?: number
}

const dateTime = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const when = (value: string) => { try { return dateTime.format(new Date(value)) } catch { return value } }
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')

/**
 * «Объявления по регионам» and «Опросы» for the owner (owner, 15.10.2026: «я нажимаю в админ приложении создать
 * объявление, выбираю категорию по снг европе итд … выбираю оплативших или нет, могу прикладывать туда фото»; «нажимаю
 * создать опрос, и нажимаю + добавить вопрос…»): the same tools in the owner app (src/notices/OwnerNoticesPanel.tsx,
 * next to «Баннер для всех») and on the website's admin panel (website/src/components/admin/AdminNotices.tsx), on the
 * same API (server/src/routes/notices.ts). `results`: where the survey statistics with the respondents' e-mails are (the
 * website's «Опросы»); the app links there, the website opens its tab.
 */
export function OwnerNoticeTools({ request, t, results }: { request: OwnerRequest; t: T; results: (id: number) => ReactNode }) {
  const [open, setOpen] = useState<'announcement' | 'survey' | null>(null)
  const [refresh, setRefresh] = useState(0)
  const sent = () => { setOpen(null); setRefresh((value) => value + 1) }
  return (
    <div className="owner-notices">
      <div className="owner-notices-create">
        <button type="button" className={`button small ${open === 'announcement' ? 'primary' : 'ghost'}`} aria-expanded={open === 'announcement'} onClick={() => setOpen(open === 'announcement' ? null : 'announcement')}>
          <Megaphone size={13} aria-hidden="true" />{t('Создать объявление')}
        </button>
        <button type="button" className={`button small ${open === 'survey' ? 'primary' : 'ghost'}`} aria-expanded={open === 'survey'} onClick={() => setOpen(open === 'survey' ? null : 'survey')}>
          <ClipboardList size={13} aria-hidden="true" />{t('Создать опрос')}
        </button>
      </div>
      {open === 'announcement' && <AnnouncementComposer request={request} t={t} onSent={sent} onCancel={() => setOpen(null)} />}
      {open === 'survey' && <SurveyBuilder request={request} t={t} onSent={sent} onCancel={() => setOpen(null)} />}
      <SentList kind="announcement" request={request} t={t} refresh={refresh} />
      <SentList kind="survey" request={request} t={t} refresh={refresh} results={results} />
    </div>
  )
}

/** «Все», «СНГ», «Европа», «Другие», «Не указана» × «Все», «Оплатившие», «Без оплаты». */
export function AudiencePicker({ value, onChange, t, disabled }: { value: NoticeAudience; onChange: (next: NoticeAudience) => void; t: T; disabled?: boolean }) {
  const all = value.regions.length === 0
  const toggle = (region: NoticeRegion) => {
    const next = value.regions.includes(region) ? value.regions.filter((item) => item !== region) : [...value.regions, region]
    // Every region ticked is «Все»; none ticked falls back to «Все» too.
    onChange({ ...value, regions: next.length === NOTICE_REGIONS.length ? [] : next })
  }
  return (
    <div className="owner-notices-audience">
      <fieldset disabled={disabled}>
        <legend>{t('Регионы')}</legend>
        <label className="owner-notices-check"><input type="checkbox" checked={all} onChange={() => onChange({ ...value, regions: [] })} />{t('Все')}</label>
        {NOTICE_REGIONS.map((region) => (
          <label key={region} className="owner-notices-check"><input type="checkbox" checked={!all && value.regions.includes(region)} onChange={() => toggle(region)} />{t(REGION_NAMES[region])}</label>
        ))}
      </fieldset>
      <fieldset disabled={disabled}>
        <legend>{t('Оплата')}</legend>
        {(['all', 'paid', 'unpaid'] as NoticePayment[]).map((payment) => (
          <label key={payment} className="owner-notices-check"><input type="radio" name="notice-payment" checked={value.payment === payment} onChange={() => onChange({ ...value, payment })} />{t(PAYMENT_NAMES[payment])}</label>
        ))}
      </fieldset>
    </div>
  )
}

interface Photo { key: string; preview: string; id?: string; error?: string }

function AnnouncementComposer({ request, t, onSent, onCancel }: { request: OwnerRequest; t: T; onSent: () => void; onCancel: () => void }) {
  const id = useId()
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [english, setEnglish] = useState(false)
  const [titleEn, setTitleEn] = useState('')
  const [textEn, setTextEn] = useState('')
  const [withButton, setWithButton] = useState(false)
  const [buttonText, setButtonText] = useState('')
  const [buttonTextEn, setButtonTextEn] = useState('')
  const [buttonUrl, setButtonUrl] = useState('')
  const [audience, setAudience] = useState<NoticeAudience>({ regions: [], payment: 'all' })
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const uploading = photos.some((photo) => !photo.id && !photo.error)

  const addPhotos = async (files: FileList | null) => {
    const room = NOTICE_LIMITS.images - photos.length
    for (const file of [...(files ?? [])].slice(0, Math.max(0, room))) {
      const key = `${file.name}-${file.size}-${Math.random()}`
      setPhotos((current) => [...current, { key, preview: '' }])
      try {
        const prepared = await prepareNoticeImage(file)
        setPhotos((current) => current.map((photo) => (photo.key === key ? { ...photo, preview: prepared.preview } : photo)))
        const answer = await request('POST', '/v1/accounts/me/admin/notices/images', { data: prepared.data }) as { image?: { id?: string } } | null
        if (!answer?.image?.id) throw new Error('Сервер недоступен')
        setPhotos((current) => current.map((photo) => (photo.key === key ? { ...photo, id: answer.image!.id } : photo)))
      } catch (reason) {
        setPhotos((current) => current.map((photo) => (photo.key === key ? { ...photo, error: errorText(reason) } : photo)))
      }
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || uploading) return
    setBusy(true)
    setError('')
    try {
      const body = {
        title, text,
        ...(english && titleEn.trim() ? { titleEn } : {}),
        ...(english && textEn.trim() ? { textEn } : {}),
        ...(withButton ? { button: { text: buttonText, url: buttonUrl.trim(), ...(english && buttonTextEn.trim() ? { textEn: buttonTextEn } : {}) } } : {}),
        audience,
        images: photos.flatMap((photo) => (photo.id ? [photo.id] : [])),
      }
      const answer = await request('POST', '/v1/accounts/me/admin/notices', body) as { notice?: OwnerNoticeView } | null
      if (!answer?.notice) throw new Error('Сервер недоступен')
      onSent()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="owner-notices-form" onSubmit={(event) => void submit(event)} aria-label={t('Новое объявление')}>
      <label className="owner-notices-field"><span>{t('Заголовок')}</span>
        <input className="input" value={title} maxLength={NOTICE_LIMITS.title} required disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder={t('Например: новая функция в приложении')} />
      </label>
      <label className="owner-notices-field"><span>{t('Текст')}</span>
        <textarea className="input" rows={4} value={text} maxLength={NOTICE_LIMITS.text} required disabled={busy} onChange={(event) => setText(event.target.value)} />
        <small className="dim">{text.length}/{NOTICE_LIMITS.text}</small>
      </label>
      <button type="button" className="link-button owner-notices-toggle" aria-expanded={english} onClick={() => setEnglish(!english)}><Languages size={13} aria-hidden="true" />{t(english ? 'Убрать английский' : 'Добавить английский (необязательно)')}</button>
      {english && <>
        <label className="owner-notices-field"><span>{t('Заголовок (EN)')}</span><input className="input" lang="en" value={titleEn} maxLength={NOTICE_LIMITS.title} disabled={busy} onChange={(event) => setTitleEn(event.target.value)} /></label>
        <label className="owner-notices-field"><span>{t('Текст (EN)')}</span><textarea className="input" lang="en" rows={3} value={textEn} maxLength={NOTICE_LIMITS.text} disabled={busy} onChange={(event) => setTextEn(event.target.value)} /></label>
        <small className="dim">{t('Игроки с английским языком приложения видят английский текст, если он есть, остальные — русский.')}</small>
      </>}
      <label className="owner-notices-check"><input type="checkbox" checked={withButton} disabled={busy} onChange={(event) => setWithButton(event.target.checked)} />{t('Кнопка со ссылкой (например, Telegram)')}</label>
      {withButton && (
        <div className="owner-notices-row">
          <label className="owner-notices-field"><span>{t('Текст кнопки')}</span><input className="input" value={buttonText} maxLength={NOTICE_LIMITS.buttonText} disabled={busy} onChange={(event) => setButtonText(event.target.value)} placeholder="Telegram" /></label>
          {english && <label className="owner-notices-field"><span>{t('Текст кнопки (EN)')}</span><input className="input" lang="en" value={buttonTextEn} maxLength={NOTICE_LIMITS.buttonText} disabled={busy} onChange={(event) => setButtonTextEn(event.target.value)} /></label>}
          <label className="owner-notices-field owner-notices-url"><span>{t('Ссылка')}</span><input className="input" type="url" inputMode="url" value={buttonUrl} maxLength={NOTICE_LIMITS.buttonUrl} disabled={busy} onChange={(event) => setButtonUrl(event.target.value)} placeholder="https://t.me/…" /></label>
        </div>
      )}
      <div className="owner-notices-field">
        <span id={`${id}-photos`}>{t('Фото')} <small className="dim">{t('до 4, JPG / PNG / WEBP, до 5 МБ')}</small></span>
        <ul className="owner-notices-photos" aria-labelledby={`${id}-photos`}>
          {photos.map((photo) => (
            <li key={photo.key} className={photo.error ? 'is-error' : undefined} title={photo.error}>
              {photo.preview ? <img src={photo.preview} alt="" /> : <LoaderCircle size={16} className="spin spinner" aria-hidden="true" />}
              {!photo.id && !photo.error && photo.preview && <span className="owner-notices-photo-state"><LoaderCircle size={14} className="spin spinner" aria-hidden="true" /></span>}
              {photo.error && <span className="owner-notices-photo-state">{photo.error}</span>}
              <button type="button" className="owner-notices-photo-remove" aria-label={t('Убрать фото')} disabled={busy} onClick={() => setPhotos((current) => current.filter((item) => item.key !== photo.key))}><X size={12} /></button>
            </li>
          ))}
          {photos.length < NOTICE_LIMITS.images && (
            <li className="owner-notices-photo-add">
              <label><ImagePlus size={18} aria-hidden="true" /><span>{t('Добавить фото')}</span>
                <input type="file" accept={NOTICE_IMAGE_TYPES.join(',')} multiple disabled={busy} onChange={(event) => { void addPhotos(event.target.files); event.target.value = '' }} />
              </label>
            </li>
          )}
        </ul>
      </div>
      <AudiencePicker value={audience} onChange={setAudience} t={t} disabled={busy} />
      {error && <p className="owner-notices-error" role="alert">{t(error)}</p>}
      <div className="owner-notices-actions">
        <button type="submit" className="button small primary" disabled={busy || uploading || !title.trim() || !text.trim()}>
          {busy ? <LoaderCircle size={13} className="spin spinner" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}{t('Отправить')}
        </button>
        <button type="button" className="button small ghost" disabled={busy} onClick={onCancel}>{t('Отмена')}</button>
        <small className="dim">{t('Получат')}: {t(audienceText(audience))}</small>
      </div>
    </form>
  )
}

export interface DraftQuestion { key: string; text: string; textEn: string; type: SurveyQuestionType; options: Array<{ key: string; text: string }>; max: string; required: boolean }
let draftKey = 0
const newKey = () => `d${(draftKey += 1)}`
const newQuestion = (): DraftQuestion => ({ key: newKey(), text: '', textEn: '', type: 'single', options: [{ key: newKey(), text: '' }, { key: newKey(), text: '' }], max: '', required: true })

const QUESTION_TYPES: Array<[SurveyQuestionType, string]> = [['single', 'Один вариант'], ['multiple', 'Несколько вариантов'], ['text', 'Свой ответ']]

function SurveyBuilder({ request, t, onSent, onCancel }: { request: OwnerRequest; t: T; onSent: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [intro, setIntro] = useState('')
  const [english, setEnglish] = useState(false)
  const [titleEn, setTitleEn] = useState('')
  const [introEn, setIntroEn] = useState('')
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => [newQuestion()])
  const [audience, setAudience] = useState<NoticeAudience>({ regions: [], payment: 'all' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const update = (key: string, change: Partial<DraftQuestion>) => setQuestions((current) => current.map((question) => (question.key === key ? { ...question, ...change } : question)))
  const move = (index: number, by: -1 | 1) => setQuestions((current) => {
    const next = [...current]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    return next
  })

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = surveyDraftProblem(title, questions)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError('')
    try {
      const body = {
        title,
        ...(intro.trim() ? { intro } : {}),
        ...(english && titleEn.trim() ? { titleEn } : {}),
        ...(english && introEn.trim() ? { introEn } : {}),
        questions: questions.map((question) => ({
          text: question.text,
          ...(english && question.textEn.trim() ? { textEn: question.textEn } : {}),
          type: question.type,
          ...(question.type === 'text' ? {} : { options: question.options.filter((option) => option.text.trim()).map((option) => ({ text: option.text })) }),
          ...(question.type === 'multiple' && question.max ? { max: Number(question.max) } : {}),
          required: question.required,
        })),
        audience,
      }
      const answer = await request('POST', '/v1/accounts/me/admin/surveys', body) as { notice?: OwnerNoticeView } | null
      if (!answer?.notice) throw new Error('Сервер недоступен')
      onSent()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="owner-notices-form" onSubmit={(event) => void submit(event)} aria-label={t('Новый опрос')} noValidate>
      <label className="owner-notices-field"><span>{t('Название опроса')}</span>
        <input className="input" value={title} maxLength={SURVEY_LIMITS.title} disabled={busy} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="owner-notices-field"><span>{t('Вступление (необязательно)')}</span>
        <textarea className="input" rows={2} value={intro} maxLength={SURVEY_LIMITS.intro} disabled={busy} onChange={(event) => setIntro(event.target.value)} />
      </label>
      <button type="button" className="link-button owner-notices-toggle" aria-expanded={english} onClick={() => setEnglish(!english)}><Languages size={13} aria-hidden="true" />{t(english ? 'Убрать английский' : 'Добавить английский (необязательно)')}</button>
      {english && <div className="owner-notices-row">
        <label className="owner-notices-field"><span>{t('Название (EN)')}</span><input className="input" lang="en" value={titleEn} maxLength={SURVEY_LIMITS.title} disabled={busy} onChange={(event) => setTitleEn(event.target.value)} /></label>
        <label className="owner-notices-field"><span>{t('Вступление (EN)')}</span><input className="input" lang="en" value={introEn} maxLength={SURVEY_LIMITS.intro} disabled={busy} onChange={(event) => setIntroEn(event.target.value)} /></label>
      </div>}
      <ol className="owner-survey-questions">
        {questions.map((question, index) => (
          <li key={question.key} className="owner-survey-question">
            <div className="owner-survey-question-head">
              <strong>{t('Вопрос')} {index + 1}</strong>
              <span className="owner-survey-question-tools">
                <button type="button" className="icon-button small" aria-label={`${t('Выше')}: ${index + 1}`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></button>
                <button type="button" className="icon-button small" aria-label={`${t('Ниже')}: ${index + 1}`} disabled={busy || index === questions.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></button>
                <button type="button" className="icon-button small" aria-label={`${t('Удалить вопрос')} ${index + 1}`} disabled={busy || questions.length === 1} onClick={() => setQuestions((current) => current.filter((item) => item.key !== question.key))}><Trash2 size={13} /></button>
              </span>
            </div>
            <input className="input" aria-label={`${t('Текст вопроса')} ${index + 1}`} value={question.text} maxLength={SURVEY_LIMITS.question} disabled={busy} onChange={(event) => update(question.key, { text: event.target.value })} placeholder={t('Текст вопроса')} />
            {english && <input className="input" lang="en" aria-label={`${t('Текст вопроса (EN)')} ${index + 1}`} value={question.textEn} maxLength={SURVEY_LIMITS.question} disabled={busy} onChange={(event) => update(question.key, { textEn: event.target.value })} placeholder={t('Текст вопроса (EN)')} />}
            <div className="owner-survey-types" role="radiogroup" aria-label={`${t('Тип ответа')} ${index + 1}`}>
              {QUESTION_TYPES.map(([type, label]) => (
                <label key={type} className="owner-notices-check"><input type="radio" name={`${question.key}-type`} checked={question.type === type} disabled={busy} onChange={() => update(question.key, { type })} />{t(label)}</label>
              ))}
            </div>
            {question.type !== 'text' && <>
              <ul className="owner-survey-options">
                {question.options.map((option, at) => (
                  <li key={option.key}>
                    <input className="input" aria-label={`${t('Вариант')} ${at + 1}, ${t('вопрос')} ${index + 1}`} value={option.text} maxLength={SURVEY_LIMITS.option} disabled={busy} placeholder={`${t('Вариант')} ${at + 1}`}
                      onChange={(event) => update(question.key, { options: question.options.map((item) => (item.key === option.key ? { ...item, text: event.target.value } : item)) })} />
                    <button type="button" className="icon-button small" aria-label={`${t('Убрать вариант')} ${at + 1}`} disabled={busy || question.options.length <= SURVEY_LIMITS.options.min} onClick={() => update(question.key, { options: question.options.filter((item) => item.key !== option.key) })}><X size={12} /></button>
                  </li>
                ))}
              </ul>
              <div className="owner-notices-row">
                <button type="button" className="button small ghost" disabled={busy || question.options.length >= SURVEY_LIMITS.options.max} onClick={() => update(question.key, { options: [...question.options, { key: newKey(), text: '' }] })}><Plus size={13} aria-hidden="true" />{t('вариант')}</button>
                {question.type === 'multiple' && <label className="owner-notices-check">{t('Не больше')}<input className="input owner-survey-max" type="number" min={1} max={question.options.length} value={question.max} disabled={busy} placeholder="—" onChange={(event) => update(question.key, { max: event.target.value })} /></label>}
              </div>
            </>}
            <label className="owner-notices-check"><input type="checkbox" checked={question.required} disabled={busy} onChange={(event) => update(question.key, { required: event.target.checked })} />{t('Обязательный')}</label>
          </li>
        ))}
      </ol>
      <button type="button" className="button small ghost owner-survey-add" disabled={busy || questions.length >= SURVEY_LIMITS.questions} onClick={() => setQuestions((current) => [...current, newQuestion()])}><Plus size={13} aria-hidden="true" />{t('Добавить вопрос')}</button>
      <AudiencePicker value={audience} onChange={setAudience} t={t} disabled={busy} />
      {error && <p className="owner-notices-error" role="alert">{t(error)}</p>}
      <div className="owner-notices-actions">
        <button type="submit" className="button small primary" disabled={busy}>{busy ? <LoaderCircle size={13} className="spin spinner" aria-hidden="true" /> : <Send size={13} aria-hidden="true" />}{t('Опубликовать')}</button>
        <button type="button" className="button small ghost" disabled={busy} onClick={onCancel}>{t('Отмена')}</button>
        <small className="dim">{t('Получат')}: {t(audienceText(audience))}</small>
      </div>
    </form>
  )
}

/** The sent announcements or surveys: date, audience, text, targeted / seen / closed, «Отозвать». */
function SentList({ kind, request, t, refresh, results }: { kind: 'announcement' | 'survey'; request: OwnerRequest; t: T; refresh: number; results?: (id: number) => ReactNode }) {
  const [items, setItems] = useState<OwnerNoticeView[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  const load = useCallback(() => request('GET', `/v1/accounts/me/admin/notices?kind=${kind}`).then((answer) => {
    const list = (answer as { notices?: OwnerNoticeView[] } | null)?.notices
    if (list) { setItems(list); setError('') }
  }, (reason: unknown) => setError(errorText(reason))), [kind, request])
  useEffect(() => { void load() }, [load, refresh])

  const withdraw = async (item: OwnerNoticeView) => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t(kind === 'survey' ? 'Отозвать опрос? Его больше никто не увидит, ответы останутся.' : 'Отозвать объявление? Его больше не увидят те, кто ещё не закрыл.'))) return
    setBusy(item.id)
    try {
      const answer = await request('POST', `/v1/accounts/me/admin/notices/${item.id}/withdraw`, {}) as { notice?: OwnerNoticeView } | null
      if (answer?.notice) setItems((current) => current?.map((value) => (value.id === item.id ? answer.notice! : value)) ?? null)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="owner-notices-sent" aria-label={t(kind === 'survey' ? 'Опросы' : 'Отправленные объявления')}>
      <div className="owner-notices-sent-head">
        <span className="eyebrow">{t(kind === 'survey' ? 'Опросы' : 'Отправленные объявления')}</span>
        <button type="button" className="icon-button small" aria-label={t('Обновить')} onClick={() => void load()}><RotateCcw size={13} /></button>
      </div>
      {error && <p className="owner-notices-error" role="alert">{t(/Не найдено|Неизвестный запрос/.test(error) ? 'Раздел доступен только аккаунту владельца на обновлённом сервере.' : error)}</p>}
      {items && !items.length && <p className="dim owner-notices-empty">{t(kind === 'survey' ? 'Опросов пока нет.' : 'Объявлений пока нет.')}</p>}
      {items && items.length > 0 && (
        <ul className="owner-notices-list">
          {items.map((item) => (
            <li key={item.id} className={item.withdrawnAt ? 'is-withdrawn' : undefined}>
              <div className="owner-notices-item-head">
                <strong>{item.title}</strong>
                {item.withdrawnAt ? <span className="tag">{t('Отозвано')}</span> : <span className="tag green">{t('Активно')}</span>}
              </div>
              <small className="dim">{when(item.createdAt)} · {t(audienceText(item.audience))}{item.images ? ` · ${t('фото')}: ${item.images}` : ''}{item.questions ? ` · ${t('вопросов')}: ${item.questions.length}` : ''}</small>
              {item.text && <p className="owner-notices-item-text">{item.text}</p>}
              <div className="owner-notices-counts">
                <span><b>{item.targeted}</b> {t('получателей')}</span>
                <span><b>{item.seen}</b> {t('увидели')}</span>
                {kind === 'survey' ? <span><b>{item.responses ?? item.closed}</b> {t('ответили')}</span> : <span><b>{item.closed}</b> {t('закрыли')}</span>}
                {kind === 'survey' && results?.(item.id)}
                {!item.withdrawnAt && <button type="button" className="button small ghost" disabled={busy === item.id} onClick={() => void withdraw(item)}><Undo2 size={13} aria-hidden="true" />{t('Отозвать')}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The app's link to the website's survey statistics (with the respondents' e-mails). */
export function SurveyResultsLink({ href, t }: { href: string; t: T }) {
  return <a className="button small ghost" href={href} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" />{t('Подробно на сайте')}</a>
}
