import { useEffect, useState } from 'react'
import { ArrowLeft, Inbox, LoaderCircle, MessagesSquare } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useOwnerChat, useOwnerChatActions, useOwnerChats, type OwnerChatThread } from '../data/ownerRequests'
import { cleanIpcError } from '../sync/serverSync'
import { SupportComposer, SupportMessageList } from './SupportChat'
import { supportTime } from './supportChatClient'
import './supportChat.css'

/** The player as the owner knows them: the game nickname, else the e-mail. */
const playerName = (player: { nickname?: string; email: string } | undefined) => player?.nickname || player?.email || uiText('аккаунт удалён')

/**
 * «Заявки» → «Чаты» (owner app only; owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): the
 * players' conversations, the latest first with the unread ones counted, and the open one with the answer box. Opening a
 * conversation marks it read; the list and the open conversation follow the «Заявки» wait (data/ownerRequests.ts).
 */
export function OwnerChats() {
  const { locale } = useLocale()
  const chats = useOwnerChats()
  const [selected, setSelected] = useState<string | null>(null)
  const threads = chats.data?.threads ?? []
  const error = chats.error instanceof Error ? cleanIpcError(chats.error) : ''
  return (
    <div className={`owner-chats${selected ? ' has-thread' : ''}`}>
      <section className="panel owner-chats-list" aria-label={uiText('Чаты')}>
        {chats.isLoading && <p className="dim"><LoaderCircle size={14} className="spin" /> {uiText('Загружаем чаты…')}</p>}
        {error && <p className="account-error" role="alert">{uiText(error)}</p>}
        {!chats.isLoading && !error && !threads.length && <p className="requests-empty"><Inbox size={20} /><span>{uiText('Переписок пока нет.')}</span></p>}
        {threads.map((thread) => (
          <button key={thread.accountId} type="button" className={`owner-chat-item${thread.accountId === selected ? ' is-active' : ''}${thread.unread ? ' is-unread' : ''}`} aria-current={thread.accountId === selected ? 'true' : undefined} onClick={() => setSelected(thread.accountId)}>
            <span className="owner-chat-name">{playerName(thread)}</span>
            <time className="owner-chat-time" dateTime={thread.lastAt}>{supportTime(thread.lastAt, locale)}</time>
            <span className="owner-chat-preview">{thread.lastMessage.author === 'owner' ? `${uiText('Вы')}: ` : ''}{thread.lastMessage.text}</span>
            {thread.unread > 0 && <span className="requests-tab-count" aria-label={uiText(`Непрочитанных: ${thread.unread}`)}>{thread.unread}</span>}
          </button>
        ))}
      </section>
      {selected
        ? <OwnerChatView key={selected} accountId={selected} thread={threads.find((thread) => thread.accountId === selected)} onBack={() => setSelected(null)} />
        : <section className="panel owner-chat-pick"><span><MessagesSquare size={16} /> {uiText('Выберите переписку слева.')}</span></section>}
    </div>
  )
}

/** One conversation: the player's messages on the left, the owner's answers on the right, the answer box under them. */
function OwnerChatView({ accountId, thread, onBack }: { accountId: string; thread?: OwnerChatThread; onBack: () => void }) {
  const chat = useOwnerChat(accountId)
  const { reply, markRead } = useOwnerChatActions()
  const unread = thread?.unread ?? 0
  // Seen once it is open and the app is in front: the conversation leaves the count (and the «Заявки» badge).
  useEffect(() => {
    if (!unread) return
    const seen = () => { if (document.visibilityState !== 'hidden') void markRead(accountId).catch(() => {}) }
    seen()
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [accountId, unread, markRead])
  const player = chat.data?.account ?? thread
  const name = playerName(player)
  return (
    <section className="panel owner-chat-thread" aria-label={name}>
      <header className="owner-chat-thread-head">
        <button type="button" className="icon-button owner-chat-back" onClick={onBack} aria-label={uiText('Все чаты')}><ArrowLeft size={16} /></button>
        <div>
          <h2>{name}</h2>
          {player?.nickname && player.email && <small>{player.email}</small>}
        </div>
      </header>
      <SupportMessageList messages={chat.data?.messages ?? []} viewer="owner" loading={chat.isLoading} error={chat.error instanceof Error ? cleanIpcError(chat.error) : ''} onRetry={() => void chat.refetch()} emptyText="Сообщений пока нет." />
      <SupportComposer onSend={(text) => reply(accountId, text)} placeholder="Ответ игроку…" autoFocus />
    </section>
  )
}
