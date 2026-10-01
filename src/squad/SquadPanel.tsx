import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Crown, DoorOpen, EyeOff, LoaderCircle, LogIn, Map as MapIcon, PackageSearch, Plus, QrCode as QrIcon, RefreshCw, ShieldAlert, Trash2, UserMinus, UserPlus, Users } from 'lucide-react'
import type { AppDataset, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { QrCode } from '../components/QrCode'
import { mapDisplayName } from '../data/mapIds'
import {
  answerSquadInvitation, createSquad, createSquadInvite, extractSquadCode, inviteFriendToSquad, joinSquad, kickMember, siteAddress, squadAction,
  type Friend, type SquadInfo,
} from './socialClient'
import { invalidateSquads, useSquad, useSquadComputed } from './useSquad'
import { CopyField, ErrorLine, MemberAvatar, MemberChips } from './squadUi'
import { friendLabel, memberLabel, modeLabel } from './squadLabels'

type Data = Pick<AppDataset, 'quests' | 'items' | 'maps'>

export function SquadPanel({ mode, data, friends, initialCode }: { mode: RaidMode; data: Data; friends: Friend[]; initialCode?: string }) {
  const { mine, overview, loading, error, reload } = useSquad(mode)
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const run = async (key: string, work: () => Promise<unknown>, success = '') => {
    setBusy(key)
    setActionError('')
    setNotice('')
    try {
      await work()
      if (success) setNotice(success)
      invalidateSquads()
      await reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  if (!mine) {
    return <div className="panel squad-loading">{loading ? <><LoaderCircle className="spin" size={18} />{uiText('Загружаем отряд…')}</> : <><ErrorLine message={error} /><button className="button small" onClick={() => void reload()}><RefreshCw size={14} />{uiText('Повторить')}</button></>}</div>
  }

  if (!mine.squad) {
    return (
      <div className="stack">
        {!mine.access && <AccessNotice />}
        {mine.invitations.length > 0 && (
          <section className="panel">
            <div className="panel-header"><div className="panel-title">{uiText('Приглашения в отряд')}</div><span className="tag brass">{mine.invitations.length}</span></div>
            <div className="panel-body squad-list">
              {mine.invitations.map((invitation) => (
                <div key={invitation.invitationId} className="squad-row">
                  <Users size={18} className="dim" />
                  <span className="squad-row-main"><strong>{invitation.squadName}</strong><small className="muted">{uiText('Командир')}: {invitation.from ?? uiText('ник не привязан')} · {invitation.members} / 5</small></span>
                  <span className="squad-row-actions">
                    <button className="button small primary" disabled={!mine.access || Boolean(busy)} onClick={() => void run(`accept:${invitation.invitationId}`, () => answerSquadInvitation(invitation.invitationId, true))}>{uiText('Вступить')}</button>
                    <button className="button small ghost" disabled={Boolean(busy)} onClick={() => void run(`decline:${invitation.invitationId}`, () => answerSquadInvitation(invitation.invitationId, false))}>{uiText('Отклонить')}</button>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div className="grid-2 squad-start">
          <CreateSquadCard disabled={!mine.access || Boolean(busy)} busy={busy === 'create'} onCreate={(name) => void run('create', () => createSquad(name))} />
          <JoinSquadCard disabled={!mine.access || Boolean(busy)} busy={busy === 'join'} initialCode={initialCode} onJoin={(code) => void run('join', () => joinSquad(code))} />
        </div>
        <ErrorLine message={actionError} />
      </div>
    )
  }

  return <SquadView squad={overview?.squad ?? mine.squad} mode={mode} data={data} friends={friends} access={mine.access} busy={busy} run={run} actionError={actionError} notice={notice} loading={loading} reload={reload} />
}

function AccessNotice() {
  return (
    <div className="panel squad-paywall">
      <ShieldAlert size={20} />
      <div><strong>{uiText('Отряд — функция подписки')}</strong><p className="muted">{uiText('Создать отряд, вступить в него и видеть общие задания можно с активной подпиской, в пробный период или со стримерским аккаунтом. Покинуть отряд можно всегда.')}</p></div>
      <Link className="button small" to="/profile">{uiText('Подписка')}</Link>
    </div>
  )
}

function CreateSquadCard({ disabled, busy, onCreate }: { disabled: boolean; busy: boolean; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); onCreate(name) }
  return (
    <form className="panel squad-card" onSubmit={submit}>
      <div className="panel-header"><div className="panel-title">{uiText('Создать отряд')}</div><Plus size={16} className="dim" /></div>
      <div className="panel-body stack">
        <p className="muted">{uiText('До 5 человек. Участники видят друг друга только по нику в игре для текущего режима — без e-mail.')}</p>
        <input className="input" value={name} maxLength={32} onChange={(event) => setName(event.target.value)} placeholder={uiText('Название (необязательно)')} aria-label={uiText('Название отряда')} />
        <button className="button primary" type="submit" disabled={disabled}>{busy ? <LoaderCircle className="spin" size={16} /> : <Users size={16} />}{uiText('Создать отряд')}</button>
      </div>
    </form>
  )
}

function JoinSquadCard({ disabled, busy, initialCode, onJoin }: { disabled: boolean; busy: boolean; initialCode?: string; onJoin: (code: string) => void }) {
  const [input, setInput] = useState(initialCode ?? '')
  const code = extractSquadCode(input)
  const submit = (event: FormEvent) => { event.preventDefault(); if (code) onJoin(code) }
  return (
    <form className="panel squad-card" onSubmit={submit}>
      <div className="panel-header"><div className="panel-title">{uiText('Вступить по коду')}</div><LogIn size={16} className="dim" /></div>
      <div className="panel-body stack">
        <p className="muted">{uiText('Введите код от командира (например 7KQ2M-9XD4F) или вставьте ссылку-приглашение. QR-код из приглашения открывается камерой телефона.')}</p>
        <input className="input mono" value={input} onChange={(event) => setInput(event.target.value)} placeholder="XXXXX-XXXXX" aria-label={uiText('Код или ссылка приглашения')} autoCapitalize="characters" spellCheck={false} />
        <button className="button primary" type="submit" disabled={disabled || !code}>{busy ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}{uiText('Вступить')}</button>
      </div>
    </form>
  )
}

interface ViewProps {
  squad: SquadInfo; mode: RaidMode; data: Data; friends: Friend[]; access: boolean; busy: string; actionError: string; notice: string; loading: boolean
  run: (key: string, work: () => Promise<unknown>, success?: string) => Promise<void>
  reload: () => Promise<void>
}

function SquadView({ squad, mode, data, friends, access, busy, run, actionError, notice, loading, reload }: ViewProps) {
  const { overview } = useSquad(mode)
  const computed = useSquadComputed(overview, data.quests)
  const [invite, setInvite] = useState<{ code: string; expiresAt: string; link: string } | null>(null)
  const [confirm, setConfirm] = useState<'' | 'leave' | 'disband'>('')
  const [mapId, setMapId] = useState<string>('')
  const names = useMemo(() => new Map(squad.members.map((member, index) => [member.memberId, { label: memberLabel(member.nickname, index), index }])), [squad.members])
  const quest = (id: string) => data.quests.find((entry) => entry.id === id)
  const item = (id: string) => data.items.find((entry) => entry.id === id)
  const mapName = (id: string) => mapDisplayName(id, data.maps)
  const maps = computed?.maps ?? []
  const selectedMap = maps.find((entry) => entry.mapId === mapId) ?? maps[0]
  const invitable = friends.filter((friend) => !squad.members.some((member) => member.nickname && member.nickname === friend.nicknames[mode]))

  const makeInvite = () => void run('invite', async () => {
    const created = await createSquadInvite(squad.id)
    const site = await siteAddress()
    setInvite({ ...created, link: site ? `${site.replace(/\/+$/, '')}/squad/${created.code}` : '' })
  })

  return (
    <div className="stack squad-view">
      {!access && <AccessNotice />}
      <section className="panel">
        <div className="panel-header squad-head">
          <div className="squad-title"><Users size={18} /><strong>{squad.name || uiText('Отряд')}</strong><span className="tag">{squad.members.length} / {squad.maxMembers}</span>{squad.isOwner && <span className="tag brass"><Crown size={11} />{uiText('Вы командир')}</span>}</div>
          <div className="squad-head-actions">
            <button className="icon-button" onClick={() => void reload()} title={uiText('Обновить')} aria-label={uiText('Обновить')}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
            {squad.isOwner && <button className="button small" disabled={!access || Boolean(busy)} onClick={makeInvite}><QrIcon size={14} />{uiText('Пригласить')}</button>}
            <button className="button small ghost" disabled={Boolean(busy)} onClick={() => setConfirm('leave')}><DoorOpen size={14} />{uiText('Покинуть отряд')}</button>
            {squad.isOwner && <button className="button small danger" disabled={Boolean(busy)} onClick={() => setConfirm('disband')}><Trash2 size={14} />{uiText('Распустить')}</button>}
          </div>
        </div>
        {confirm && (
          <div className="squad-confirm" role="alertdialog">
            <span>{uiText(confirm === 'leave' ? 'Покинуть отряд? Вернуться можно по новому приглашению.' : 'Распустить отряд? Все участники будут исключены.')}</span>
            <button className="button small danger" onClick={() => { const action = confirm; setConfirm(''); void run(action, () => squadAction(squad.id, action)) }}>{uiText(confirm === 'leave' ? 'Покинуть' : 'Распустить')}</button>
            <button className="button small ghost" onClick={() => setConfirm('')}>{uiText('Отмена')}</button>
          </div>
        )}
        {invite && (
          <div className="squad-invite">
            <div className="squad-invite-text">
              <CopyField label={uiText('Код')} value={invite.code} />
              {invite.link && <CopyField label={uiText('Ссылка')} value={invite.link} />}
              <small className="muted">{uiText('Действует 24 часа, новый код отменяет прежний. Отправляйте только тем, кого зовёте в отряд.')}</small>
            </div>
            {invite.link && <QrCode value={invite.link} size={148} label={uiText('QR-код приглашения в отряд')} />}
          </div>
        )}
        <div className="panel-body squad-members">
          {squad.members.map((member, index) => {
            const label = memberLabel(member.nickname, index)
            return (
              <div key={member.memberId} className={`squad-member${member.isYou ? ' is-you' : ''}`}>
                <MemberAvatar name={label} index={index} />
                <span className="squad-row-main">
                  <strong>{label}{!member.nickname && <small className="dim"> · {uiText('ник для')} {modeLabel(mode)} {uiText('не привязан')}</small>}</strong>
                  <small className="muted">
                    {member.isOwner && <span className="tag brass"><Crown size={10} />{uiText('Командир')}</span>}
                    {member.isYou && <span className="tag green">{uiText('Вы')}</span>}
                    {member.hidden ? <span className="tag"><EyeOff size={10} />{uiText('Скрыл прогресс')}</span> : member.activeQuestIds && <span>{uiText('Активных заданий')}: {member.activeQuestIds.length}</span>}
                    {member.lastSyncAt === null && !member.hidden && <span className="dim">{uiText('нет данных из игры')}</span>}
                  </small>
                </span>
                {squad.isOwner && !member.isYou && <button className="icon-button" title={uiText('Исключить')} aria-label={uiText('Исключить')} disabled={Boolean(busy)} onClick={() => void run(`kick:${member.memberId}`, () => kickMember(squad.id, member.memberId))}><UserMinus size={15} /></button>}
              </div>
            )
          })}
        </div>
        {squad.isOwner && invitable.length > 0 && squad.members.length < squad.maxMembers && (
          <div className="squad-friend-invites">
            <span className="stat-label">{uiText('Позвать друзей')}</span>
            <div className="squad-chips">
              {invitable.slice(0, 12).map((friend) => (
                <button key={friend.friendId} className="button small ghost" disabled={!access || Boolean(busy)} onClick={() => void run(`friend:${friend.friendId}`, () => inviteFriendToSquad(squad.id, friend.friendId), 'Приглашение отправлено: друг увидит его на странице «Отряд».')}><UserPlus size={13} />{friendLabel(friend.nicknames, mode)}</button>
              ))}
            </div>
          </div>
        )}
        <ErrorLine message={actionError} />
        {notice && <p className="squad-notice" role="status">{uiText(notice)}</p>}
      </section>

      {access && computed && (
        <>
          <section className="panel">
            <div className="panel-header"><div className="panel-title">{uiText('Общие квесты')} · {modeLabel(mode)}</div><span className="tag brass">{computed.sharedQuests.length}</span></div>
            <div className="panel-body">
              {maps.length > 0 ? (
                <>
                  <div className="squad-map-picker" role="tablist" aria-label={uiText('Карта')}>
                    {maps.map((entry) => (
                      <button key={entry.mapId} role="tab" aria-selected={selectedMap?.mapId === entry.mapId} className={selectedMap?.mapId === entry.mapId ? 'active' : ''} onClick={() => setMapId(entry.mapId)}>
                        <MapIcon size={13} />{uiText(mapName(entry.mapId))}{entry.sharedCount > 0 && <span className="squad-count">{entry.sharedCount}</span>}
                      </button>
                    ))}
                  </div>
                  {selectedMap && (
                    <div className="squad-list">
                      {selectedMap.quests.map((entry) => {
                        const found = quest(entry.questId)
                        const shared = entry.memberIds.length >= 2
                        return (
                          <div key={entry.questId} className={`squad-row${shared ? ' is-shared' : ''}`}>
                            <span className="squad-row-main">
                              <strong>{uiText(found?.name ?? entry.questId)}</strong>
                              <small className="muted">{uiText(found?.trader ?? '')}{shared && <> · <span className="squad-shared-label">{uiText('общий')} ×{entry.memberIds.length}</span></>}</small>
                            </span>
                            <MemberChips ids={entry.memberIds} names={names} />
                          </div>
                        )
                      })}
                      <Link className="button small ghost squad-open-map" to={`/maps/${selectedMap.mapId}`}><MapIcon size={14} />{uiText('Открыть карту')}</Link>
                    </div>
                  )}
                </>
              ) : <p className="muted">{uiText('Пока нет активных заданий с картой. Они появятся, когда участники примут задания в игре и приложение для ПК отправит прогресс на сервер.')}</p>}
              {computed.anyMap.length > 0 && (
                <div className="squad-anymap">
                  <span className="stat-label">{uiText('Любая карта')}</span>
                  {computed.anyMap.map((entry) => (
                    <div key={entry.questId} className={`squad-row${entry.memberIds.length >= 2 ? ' is-shared' : ''}`}>
                      <span className="squad-row-main"><strong>{uiText(quest(entry.questId)?.name ?? entry.questId)}</strong></span>
                      <MemberChips ids={entry.memberIds} names={names} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header"><div className="panel-title">{uiText('Предметы, нужные нескольким')}</div><PackageSearch size={15} className="dim" /></div>
            <div className="panel-body squad-list">
              {computed.items.length ? computed.items.map((entry) => {
                const found = item(entry.itemId)
                return (
                  <div key={entry.itemId} className="squad-row">
                    {found?.iconUrl ? <img className="item-thumb" src={found.iconUrl} alt="" /> : <PackageSearch size={18} className="dim" />}
                    <span className="squad-row-main">
                      <strong>{uiText(found?.name ?? entry.itemId)} <span className="mono">×{entry.total}</span></strong>
                      <small className="muted">{entry.fir && <span className="tag brass">{uiText('Найден в рейде')}</span>} {entry.members.map((row) => `${names.get(row.memberId)?.label ?? '—'} ×${row.count}`).join(' · ')}</small>
                    </span>
                  </div>
                )
              }) : <p className="muted">{uiText('Общих предметов для заданий пока нет.')}</p>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
