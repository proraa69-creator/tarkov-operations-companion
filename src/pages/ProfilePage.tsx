import { uiText } from '../i18n/renderText'
import { ExternalLink, ShieldCheck, UserRound } from 'lucide-react'
import { ACCOUNT_URL } from '../shared/links'
import { PlayerLoadoutSummary } from '../components/PlayerLoadoutSummary'
import { useAppState } from '../state/AppState'
import { ServerAccountPanel } from '../components/ServerAccountPanel'
import { isOwnerApp } from '../app/buildEdition'
import { ClientCabinetPanel } from '../account/ClientCabinetPanel'
import { StreamerCabinetPanel } from '../account/StreamerCabinetPanel'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import { useAccountNickname } from '../account/useAccountNickname'
import '../account/account.css'

export function ProfilePage() {
  const state = useAppState()
  const { status } = useServerAccount()
  const owner = isOwnerApp()
  const progress = state.activeProfile.modes[state.raidMode]
  const modeName = state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase()
  // Owner build: «Аккаунт сервера» with the server controls. Players (and the phone): «Личный кабинет»; the phone
  // signs in with the form of «Аккаунт сервера» (Settings has the server address).
  const accountBlock = owner
    ? <ServerAccountPanel />
    : usesWebAccount() && !status?.signedIn ? <ServerAccountPanel /> : <ClientCabinetPanel />

  return <div className="page">
    <header className="page-header">
      <div><div className="eyebrow">{uiText(owner ? 'Локальная учётная запись' : 'Аккаунт')}</div><h1 className="page-title">{uiText("Профиль оператора")}</h1><p className="page-subtitle">{uiText("Данные персонажа обновляются каждую минуту.")}</p></div>
      <span className="tag green"><ShieldCheck size={12} />{uiText(" только чтение")}</span>
    </header>
    <div className="profile-operator-layout">
      <NicknamePanel />
      <section className="panel profile-live-card">
        <div className="panel-header"><div><div className="eyebrow">{uiText("Текущий профиль · ")}{uiText(modeName)}</div><div className="panel-title">{uiText(progress.playerSnapshot?.nickname ?? state.activeProfile.displayName)}</div></div>{uiText(progress.playerSnapshot?.upstreamUpdatedAt && <small className="dim">{uiText(new Date(progress.playerSnapshot.upstreamUpdatedAt).toLocaleString('ru-RU'))}</small>)}</div>
        <div className="panel-body"><PlayerLoadoutSummary snapshot={progress.playerSnapshot} /></div>
        {owner && <div className="profile-live-footer"><a className="button primary" href={ACCOUNT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{uiText(" Личный кабинет")}</a></div>}
      </section>
    </div>
    {accountBlock}
    {status?.kind === 'streamer' && <StreamerCabinetPanel />}
  </div>
}

/**
 * «Персонаж»: one Escape from Tarkov nickname for PvP, PvE and «Сезон» (owner, 10.10.2026). Read only — the app takes it
 * from the game logs by itself (account/logNickname.ts); there is no manual binding any more.
 */
function NicknamePanel() {
  const nickname = useAccountNickname()
  return (
    <section className="panel profile-character-panel is-compact">
      <div className="panel-header"><div><div className="eyebrow">{uiText('Ник · PvP · PvE · Сезон')}</div><div className="panel-title">{nickname ?? uiText('Ник ещё не найден')}</div></div><UserRound size={18} className="dim" /></div>
      <div className="panel-body"><p className="profile-nick-message">{uiText(nickname
        ? 'Ник берётся из логов игры автоматически и один для всех режимов.'
        : 'Ник появится сам, когда приложение прочитает логи игры. Запустите Escape from Tarkov.')}</p></div>
    </section>
  )
}
