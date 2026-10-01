import { useEffect, useState, type FormEvent } from 'react'
import { Ban, Check, ChevronDown, ChevronUp, Eye, EyeOff, LoaderCircle, RefreshCw, ShieldAlert, UserMinus, UserPlus, X } from 'lucide-react'
import type { AppDataset, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { QrCode } from '../components/QrCode'
import {
  answerFriendRequest, extractFriendCode, fetchPlannerPeople, friendAction, regenerateFriendCode, sendFriendRequest, setHideProgress, siteAddress,
  type Friend, type FriendsOverview, type PlannerPerson,
} from './socialClient'
import { CopyField, ErrorLine } from './squadUi'
import { friendLabel, modeLabel } from './squadLabels'

const NICKNAME = /^[a-zA-Z0-9_-]{3,15}$/

export function FriendsPanel({ mode, data, friends, error, loading, reload, initialCode }: {
  mode: RaidMode; data: Pick<AppDataset, 'quests'>; friends: FriendsOverview | null; error: string; loading: boolean; reload: () => Promise<void>; initialCode?: string
}) {
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [link, setLink] = useState('')
  const [showQr, setShowQr] = useState(false)

  useEffect(() => {
    if (!friends?.code) return
    let active = true
    void siteAddress().then((site) => { if (active) setLink(site ? `${site.replace(/\/+$/, '')}/friend/${friends.code}` : '') })
    return () => { active = false }
  }, [friends?.code])

  const run = async (key: string, work: () => Promise<unknown>, success: string | ((result: unknown) => string) = '') => {
    setBusy(key)
    setActionError('')
    setNotice('')
    try {
      const result = await work()
      const text = typeof success === 'function' ? success(result) : success
      if (text) setNotice(text)
      await reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  if (!friends) {
    return <div className="panel squad-loading">{loading ? <><LoaderCircle className="spin" size={18} />{uiText('Загружаем друзей…')}</> : <><ErrorLine message={error} /><button className="button small" onClick={() => void reload()}><RefreshCw size={14} />{uiText('Повторить')}</button></>}</div>
  }

  return (
    <div className="stack">
      {!friends.access && (
        <div className="panel squad-paywall">
          <ShieldAlert size={20} />
          <div><strong>{uiText('Друзья — функция подписки')}</strong><p className="muted">{uiText('Добавлять друзей и видеть их задания можно с активной подпиской, в пробный период или со стримерским аккаунтом. Отвечать на запросы, удалять и блокировать можно всегда.')}</p></div>
        </div>
      )}
      <div className="grid-2 squad-start">
        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText('Мой код друга')}</div><button className="button small ghost" disabled={Boolean(busy)} onClick={() => void run('code', regenerateFriendCode, 'Новый код создан: старые код и ссылка больше не работают.')}><RefreshCw size={13} />{uiText('Новый код')}</button></div>
          <div className="panel-body stack">
            <CopyField label={uiText('Код')} value={friends.code} />
            {link && <CopyField label={uiText('Ссылка')} value={link} />}
            {link && <button type="button" className="button small ghost" onClick={() => setShowQr((value) => !value)}>{uiText(showQr ? 'Скрыть QR-код' : 'Показать QR-код')}</button>}
            {showQr && link && <QrCode value={link} size={160} label={uiText('QR-код для добавления в друзья')} />}
            <small className="muted">{uiText('По коду вам придёт запрос — в друзья никто не попадёт без вашего согласия.')}</small>
          </div>
        </section>
        <AddFriendCard mode={mode} disabled={!friends.access || Boolean(busy)} busy={busy === 'add'} initialCode={initialCode}
          onAdd={(target) => void run('add', () => sendFriendRequest(target), (result) => ((result as { status?: string } | null)?.status === 'friends' ? 'Теперь вы друзья.' : 'Запрос отправлен. Друг появится в списке, когда примет его.'))} />
      </div>
      <ErrorLine message={actionError} />
      {notice && <p className="squad-notice" role="status">{uiText(notice)}</p>}

      {friends.incoming.length > 0 && (
        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText('Запросы в друзья')}</div><span className="tag brass">{friends.incoming.length}</span></div>
          <div className="panel-body squad-list">
            {friends.incoming.map((request) => (
              <div key={request.requestId} className="squad-row">
                <UserPlus size={17} className="dim" />
                <span className="squad-row-main"><strong>{friendLabel(request.nicknames, mode)}</strong><small className="muted">{new Date(request.createdAt).toLocaleDateString()}</small></span>
                <span className="squad-row-actions">
                  <button className="button small primary" disabled={Boolean(busy)} onClick={() => void run(`accept:${request.requestId}`, () => answerFriendRequest(request.requestId, 'accept'))}><Check size={13} />{uiText('Принять')}</button>
                  <button className="button small ghost" disabled={Boolean(busy)} onClick={() => void run(`decline:${request.requestId}`, () => answerFriendRequest(request.requestId, 'decline'))}><X size={13} />{uiText('Отклонить')}</button>
                  <button className="icon-button" title={uiText('Заблокировать')} aria-label={uiText('Заблокировать')} disabled={Boolean(busy)} onClick={() => void run(`block:${request.friendId}`, () => friendAction(request.friendId, 'block'))}><Ban size={14} /></button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-header"><div className="panel-title">{uiText('Друзья')}</div><span className="tag">{friends.friends.length}</span></div>
        <div className="panel-body squad-list">
          {friends.friends.length ? friends.friends.map((friend) => (
            <FriendRow key={friend.friendId} friend={friend} mode={mode} quests={data.quests} busy={Boolean(busy)} access={friends.access}
              onPrivacy={(hide) => void run(`privacy:${friend.friendId}`, () => setHideProgress(friend.friendId, hide))}
              onRemove={() => void run(`remove:${friend.friendId}`, () => friendAction(friend.friendId, 'remove'))}
              onBlock={() => void run(`block:${friend.friendId}`, () => friendAction(friend.friendId, 'block'))} />
          )) : <p className="muted">{uiText('Друзей пока нет. Отправьте свой код или добавьте друга по его коду или нику в игре.')}</p>}
        </div>
      </section>

      {friends.outgoing.length > 0 && (
        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText('Отправленные запросы')}</div><span className="tag">{friends.outgoing.length}</span></div>
          <div className="panel-body squad-list">
            {friends.outgoing.map((request) => (
              <div key={request.requestId} className="squad-row">
                <span className="squad-row-main"><strong className="mono">{request.label}</strong><small className="muted">{uiText('ждёт ответа')}</small></span>
                <button className="button small ghost" disabled={Boolean(busy)} onClick={() => void run(`cancel:${request.requestId}`, () => answerFriendRequest(request.requestId, 'cancel'))}>{uiText('Отозвать заявку')}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {friends.blocked.length > 0 && (
        <section className="panel">
          <div className="panel-header"><div className="panel-title">{uiText('Заблокированные')}</div></div>
          <div className="panel-body squad-list">
            {friends.blocked.map((entry) => (
              <div key={entry.friendId} className="squad-row">
                <span className="squad-row-main"><strong>{friendLabel(entry.nicknames, mode)}</strong></span>
                <button className="button small ghost" disabled={Boolean(busy)} onClick={() => void run(`unblock:${entry.friendId}`, () => friendAction(entry.friendId, 'unblock'))}>{uiText('Разблокировать')}</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function AddFriendCard({ mode, disabled, busy, initialCode, onAdd }: { mode: RaidMode; disabled: boolean; busy: boolean; initialCode?: string; onAdd: (target: { code: string } | { mode: RaidMode; nickname: string }) => void }) {
  const [input, setInput] = useState(initialCode ?? '')
  const code = extractFriendCode(input)
  const nickname = !code && NICKNAME.test(input.trim()) ? input.trim() : ''
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (code) onAdd({ code })
    else if (nickname) onAdd({ mode, nickname })
  }
  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header"><div className="panel-title">{uiText('Добавить в друзья')}</div><UserPlus size={16} className="dim" /></div>
      <div className="panel-body stack">
        <p className="muted">{uiText('Код друга (XXXX-XXXX), ссылка-приглашение или ник в игре для режима')} {modeLabel(mode)}.</p>
        <input className="input" value={input} onChange={(event) => setInput(event.target.value)} placeholder={uiText('Код, ссылка или ник')} aria-label={uiText('Код, ссылка или ник')} spellCheck={false} />
        <button className="button primary" type="submit" disabled={disabled || (!code && !nickname)}>{busy ? <LoaderCircle className="spin" size={16} /> : <UserPlus size={16} />}{uiText(code ? 'Отправить запрос по коду' : nickname ? 'Отправить запрос по нику' : 'Добавить в друзья')}</button>
      </div>
    </form>
  )
}

function FriendRow({ friend, mode, quests, busy, access, onPrivacy, onRemove, onBlock }: {
  friend: Friend; mode: RaidMode; quests: AppDataset['quests']; busy: boolean; access: boolean
  onPrivacy: (hide: boolean) => void; onRemove: () => void; onBlock: () => void
}) {
  const [open, setOpen] = useState(false)
  const [person, setPerson] = useState<PlannerPerson | null>(null)
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!open) return
    let active = true
    fetchPlannerPeople(mode, [friend.friendId]).then((people) => { if (active) { setError(''); setPerson(people.find((entry) => entry.id === friend.friendId) ?? null) } }, (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [open, mode, friend.friendId])
  const name = (id: string) => quests.find((quest) => quest.id === id)?.name ?? id

  return (
    <div className="squad-friend">
      <div className="squad-row">
        <span className="squad-row-main">
          <strong>{friendLabel(friend.nicknames, mode)}</strong>
          <small className="muted">{!friend.sharesProgress && <span className="tag"><EyeOff size={10} />{uiText('скрывает от вас прогресс')}</span>}</small>
        </span>
        <label className="squad-toggle" title={uiText('Этот друг не будет видеть ваши задания, прогресс и нужные предметы — и в отряде тоже.')}>
          <input type="checkbox" checked={friend.hideMyProgress} disabled={busy} onChange={(event) => onPrivacy(event.target.checked)} />
          {friend.hideMyProgress ? <EyeOff size={13} /> : <Eye size={13} />}<span>{uiText('Скрывать мой прогресс')}</span>
        </label>
        <span className="squad-row-actions">
          <button className="button small ghost" disabled={!access || !friend.sharesProgress} onClick={() => setOpen((value) => !value)} aria-expanded={open}>{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{uiText('Задания')}</button>
          <button className="icon-button" title={uiText('Удалить из друзей')} aria-label={uiText('Удалить из друзей')} disabled={busy} onClick={() => setConfirm(true)}><UserMinus size={14} /></button>
          <button className="icon-button" title={uiText('Заблокировать')} aria-label={uiText('Заблокировать')} disabled={busy} onClick={onBlock}><Ban size={14} /></button>
        </span>
      </div>
      {confirm && (
        <div className="squad-confirm" role="alertdialog">
          <span>{uiText('Удалить из друзей?')}</span>
          <button className="button small danger" onClick={() => { setConfirm(false); onRemove() }}>{uiText('Удалить')}</button>
          <button className="button small ghost" onClick={() => setConfirm(false)}>{uiText('Отмена')}</button>
        </div>
      )}
      {open && (
        <div className="squad-friend-detail">
          <ErrorLine message={error} />
          {person && (person.hidden ? <p className="muted">{uiText('Друг скрыл от вас прогресс.')}</p> : (
            <>
              <small className="muted">{uiText('Выполнено заданий')}: {person.completedCount} · {uiText('активных')}: {person.activeQuestIds.length} · {modeLabel(mode)}</small>
              <div className="squad-chips">{person.activeQuestIds.slice(0, 40).map((id) => <span key={id} className="tag">{uiText(name(id))}</span>)}</div>
              {!person.activeQuestIds.length && <p className="muted">{uiText('Нет активных заданий в этом режиме.')}</p>}
            </>
          ))}
        </div>
      )}
    </div>
  )
}
