import { uiText } from '../i18n/renderText'
import { ExternalLink, Pencil, ShieldCheck, UserRound } from 'lucide-react'
import { ACCOUNT_URL } from '../shared/links'
import { openModeRegistrationDialog } from '../components/ModeRegistrationDialog'
import { PlayerLoadoutSummary } from '../components/PlayerLoadoutSummary'
import { useAppState } from '../state/AppState'
import { ServerAccountPanel } from '../components/ServerAccountPanel'
import { isOwnerApp } from '../app/buildEdition'
import { ClientCabinetPanel } from '../account/ClientCabinetPanel'
import { StreamerCabinetPanel } from '../account/StreamerCabinetPanel'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import '../account/account.css'

export function ProfilePage() {
  const state = useAppState()
  const { status } = useServerAccount()
  const owner = isOwnerApp()
  const progress = state.activeProfile.modes[state.raidMode]
  const modeName = state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase()
  const changeNickname = () => {
    const mode = state.raidMode.toUpperCase()
    if (!window.confirm(`Сменить ник для ${mode}? Прогресс и привязка текущего режима будут сброшены. Остальные режимы не изменятся.`)) return
    state.clearModeProfile(state.raidMode)
    window.setTimeout(() => openModeRegistrationDialog(), 0)
  }
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
      <section className="panel profile-character-panel">
        <div className="panel-header"><div><div className="eyebrow">{uiText('Привязка ника · ')}{uiText(modeName)}</div><div className="panel-title">{uiText("Персонаж")}</div></div></div>
        <div className="panel-body stack">
          <div className="field-label">{uiText("Режим ")}<div className="mode-switch wide">
              <button className={state.raidMode === 'pvp' ? 'active' : ''} onClick={() => state.setRaidMode('pvp')}>PvP</button>
              <button className={state.raidMode === 'pve' ? 'active' : ''} onClick={() => state.setRaidMode('pve')}>PvE</button>
              <button className={state.raidMode === 'seasonal' ? 'active' : ''} onClick={() => state.setRaidMode('seasonal')}>{uiText("Сезон")}</button>
            </div>
          </div>
          <div className="setting-row">
            <span><strong>{uiText(progress.registration.nickname ?? 'Ник не привязан')}</strong><small>{uiText(progress.registration.status === 'registered' ? `Tarkov ID ${progress.registration.accountId} · автообновление 1 мин.` : 'Привяжите ник для выбранного режима')}</small></span>
            <span className={`tag ${progress.registration.status === 'registered' ? 'green' : 'brass'}`}>{uiText(progress.registration.status === 'registered' ? 'Привязан' : 'Не настроен')}</span>
          </div>
          {uiText(progress.registration.status === 'registered'
            ? <button className="button danger" onClick={changeNickname}><Pencil size={14} />{uiText(" Смена ника (вайп)")}</button>
            : <button className="button primary" onClick={openModeRegistrationDialog}><UserRound size={14} />{uiText(" Привязать ник")}</button>)}
        </div>
      </section>
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
