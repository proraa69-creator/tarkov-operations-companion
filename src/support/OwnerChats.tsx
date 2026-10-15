import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CheckCircle2, Inbox, LoaderCircle, MessagesSquare } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { OWNER_CHATS_KEY, useOwnerChat, useOwnerChatActions, useOwnerChats, type OwnerChatDetail, type OwnerChatThread } from '../data/ownerRequests'
import { cleanIpcError } from '../sync/serverSync'
import { SupportComposer, SupportMessageList } from './SupportChat'
import { supportTime } from './supportChatClient'
import { FindUserToWrite } from './FindUserToWrite'
import { SUPPORT_IMAGE_PLACEHOLDER } from '../shared/supportChat'
import './supportChat.css'

/** The player as the owner knows them: the game nickname, else the e-mail. */
const playerName = (player: { nickname?: string; email: string } | undefined) => player?.nickname || player?.email || uiText('аккаунт удалён')

/**
 * «Заявки» → «Чаты» (owner app only; owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): the
 * players' conversations, the latest first with the unread ones counted, and the open one with the answer box. Opening a
 * conversation marks it read; the list and the open conversation follow the «Заявки» wait (data/ownerRequests.ts).
 *
 * «Открыть чат» on a report (owner, 14.10.2026: «где я отметил добавь открыть чат и туда можно будет писать») opens its
 * author's conversation here (`selected`), also one with no message yet: the owner writes first. «Проблема решена»
 * («добавь кнопку у админ версии, проблема решена. и данный чат удаляется») deletes the whole conversation for both sides
 * after «Удалить переписку?» → «Да»; the report it came from stays as it is.
 *
 * Screenshots (owner, 15.10.2026): the players' show in the conversation (a click opens them full size), and the owner
 * attaches them to an answer the same way (the paperclip, Ctrl+V, a drop on the conversation). A conversation whose
 * latest message is screenshots only reads «[скриншот]» in the list.
 */
export function OwnerChats({ selected, onSelect }: { selected: string | null; onSelect: (accountId: string | null) => void }) {
  const { locale } = useLocale()
  const chats = useOwnerChats()
  const threads = chats.data?.threads ?? []
  const error = chats.error instanceof Error ? cleanIpcError(chats.error) : ''
  return (
    <div className={`owner-chats${selected ? ' has-thread' : ''}`}>
      <section className="panel owner-chats-list" aria-label={uiText('Чаты')}>
        {/* «Написать пользователю» (owner, 15.10.2026): find an account by e-mail and write first. */}
        <FindUserToWrite onPick={onSelect} />
        {chats.isLoading && <p className="dim"><LoaderCircle size={14} className="spin" /> {uiText('Загружаем чаты…')}</p>}
        {error && <p className="account-error" role="alert">{uiText(error)}</p>}
        {!chats.isLoading && !error && !threads.length && <p className="requests-empty"><Inbox size={20} /><span>{uiText('Переписок пока нет.')}</span></p>}
        {threads.map((thread) => (
          <button key={thread.accountId} type="button" className={`owner-chat-item${thread.accountId === selected ? ' is-active' : ''}${thread.unread ? ' is-unread' : ''}`} aria-current={thread.accountId === selected ? 'true' : undefined} onClick={() => onSelect(thread.accountId)}>
            <span className="owner-chat-name">{playerName(thread)}</span>
            <time className="owner-chat-time" dateTime={thread.lastAt}>{supportTime(thread.lastAt, locale)}</time>
            <span className="owner-chat-preview">{thread.lastMessage.author === 'owner' ? `${uiText('Вы')}: ` : ''}{thread.lastMessage.text === SUPPORT_IMAGE_PLACEHOLDER ? uiText(SUPPORT_IMAGE_PLACEHOLDER) : thread.lastMessage.text}</span>
            {thread.unread > 0 && <span className="requests-tab-count" aria-label={uiText(`Непрочитанных: ${thread.unread}`)}>{thread.unread}</span>}
          </button>
        ))}
      </section>
      {selected
        ? <OwnerChatView key={selected} accountId={selected} thread={threads.find((thread) => thread.accountId === selected)} onBack={() => onSelect(null)} />
        : <section className="panel owner-chat-pick"><span><MessagesSquare size={16} /> {uiText('Выберите переписку слева.')}</span></section>}
    </div>
  )
}

/**
 * «Проблема решена»: DELETE the conversation (server/src/routes/supportChat.ts; the owner app is the desktop one, so
 * through its gateway). Opened again from a report it starts empty at once; the list and «Чаты» are read again, the
 * «Заявки» badge follows the server's wait.
 */
function useResolveOwnerChat() {
  const client = useQueryClient()
  return useCallback(async (accountId: string) => {
    const request = window.tarkovDesktop?.serviceRequest
    if (!request) throw new Error('Нет связи с сервером')
    await request('DELETE', `/v1/accounts/me/admin/support/threads/${accountId}`)
    client.setQueryData<OwnerChatDetail>([...OWNER_CHATS_KEY, 'thread', accountId], (current) => (current ? { ...current, messages: [] } : current))
    await client.invalidateQueries({ queryKey: OWNER_CHATS_KEY })
  }, [client])
}

/** One conversation: the player's messages on the left, the owner's answers on the right, the answer box under them. */
function OwnerChatView({ accountId, thread, onBack }: { accountId: string; thread?: OwnerChatThread; onBack: () => void }) {
  const chat = useOwnerChat(accountId)
  const { reply, markRead } = useOwnerChatActions()
  const resolve = useResolveOwnerChat()
  const [confirming, setConfirming] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const resolveButton = useRef<HTMLButtonElement>(null)
  const view = useRef<HTMLElement>(null)
  const noButton = useRef<HTMLButtonElement>(null)
  // Another conversation opened meanwhile stays open when the deletion ends.
  const shown = useRef(true)
  useEffect(() => {
    shown.current = true
    return () => { shown.current = false }
  }, [])
  const unread = thread?.unread ?? 0
  // Seen once it is open and the app is in front: the conversation leaves the count (and the «Заявки» badge).
  useEffect(() => {
    if (!unread) return
    const seen = () => { if (document.visibilityState !== 'hidden') void markRead(accountId).catch(() => {}) }
    seen()
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [accountId, unread, markRead])
  // «Удалить переписку?» takes the focus on «Нет» (Enter never deletes by accident); «Нет» gives it back.
  const asked = useRef(false)
  useEffect(() => {
    if (confirming) { asked.current = true; noButton.current?.focus(); return }
    if (asked.current) { asked.current = false; resolveButton.current?.focus() }
  }, [confirming])
  const player = chat.data?.account ?? thread
  // Opened from a report, the conversation may not be in the list: no name until its account is read.
  const name = player || !chat.isLoading ? playerName(player) : '…'
  const messages = chat.data?.messages ?? []
  const cancel = () => setConfirming(false)
  const confirm = async () => {
    setResolving(true)
    setResolveError('')
    try {
      await resolve(accountId)
      if (shown.current) onBack()
    } catch (reason) {
      setResolveError(cleanIpcError(reason) || 'Сервер недоступен')
      setResolving(false)
    }
  }
  return (
    <section ref={view} className="panel owner-chat-thread" aria-label={name}>
      <header className="owner-chat-thread-head">
        <button type="button" className="icon-button owner-chat-back" onClick={onBack} aria-label={uiText('Все чаты')}><ArrowLeft size={16} /></button>
        <div className="owner-chat-who">
          <h2>{name}</h2>
          {player?.nickname && player.email && <small>{player.email}</small>}
        </div>
        {(messages.length > 0 || confirming) && <div className="owner-chat-resolve" role="group" aria-label={uiText('Проблема решена')} onKeyDown={(event) => { if (event.key === 'Escape' && confirming && !resolving) cancel() }}>
          {confirming ? <>
            <span>{uiText('Удалить переписку?')}</span>
            <button type="button" className="button small danger" disabled={resolving} onClick={() => void confirm()}>{resolving && <LoaderCircle size={13} className="spin" />}{uiText('Да')}</button>
            <button ref={noButton} type="button" className="button small ghost" disabled={resolving} onClick={cancel}>{uiText('Нет')}</button>
          </> : <button ref={resolveButton} type="button" className="button small" onClick={() => { setResolveError(''); setConfirming(true) }}><CheckCircle2 size={13} />{uiText('Проблема решена')}</button>}
        </div>}
      </header>
      {resolveError && <div className="support-chat-error" role="alert"><AlertTriangle size={15} /><span>{uiText(resolveError)}</span></div>}
      <SupportMessageList messages={messages} viewer="owner" loading={chat.isLoading} error={chat.error instanceof Error ? cleanIpcError(chat.error) : ''} onRetry={() => void chat.refetch()} emptyText="Сообщений пока нет." />
      <SupportComposer onSend={(text, images) => reply(accountId, text, images)} placeholder="Ответ игроку…" autoFocus allowImages dropZone={view} />
    </section>
  )
}
