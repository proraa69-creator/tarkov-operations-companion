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
import { NicknameEditor } from '../account/NicknameEditor'
import { outdatedProfile } from '../account/logNickname'
import { MovedToAdminPanel } from '../admin/MovedToAdminPanel'
import { DonateCard } from '../components/DonateCard'
import { ModeResetButtons, PrestigeLine } from '../components/PrestigeResetButton'
import { useLocale } from '../i18n/LocaleProvider'
import { QuestDiagnosticsPanel } from '../quests/QuestDiagnosticsPanel'
import '../account/account.css'

export function ProfilePage() {
  const state = useAppState()
  const { status } = useServerAccount()
  const owner = isOwnerApp()
  const { locale } = useLocale()
  const progress = state.activeProfile.modes[state.raidMode]
  const modeName = state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase()
  const currentNickname = useAccountNickname()
  // A Tarkov.dev profile with another name was captured before the rename: not shown (account/logNickname.ts).
  const snapshot = progress.playerSnapshot && !outdatedProfile(progress.playerSnapshot, currentNickname) ? progress.playerSnapshot : undefined
  // Owner build: «Аккаунт сервера» with the server controls. Players (and the phone): «Личный кабинет»; the phone
  // signs in with the form of «Аккаунт сервера» (Settings has the server address).
  const accountBlock = owner
    ? <ServerAccountPanel />
    : usesWebAccount() && !status?.signedIn ? <ServerAccountPanel /> : <ClientCabinetPanel />

  return <div className="page">
    <header className="page-header">
      <div><div className="eyebrow">{uiText(owner ? 'Локальная учётная запись' : 'Аккаунт')}</div><h1 className="page-title">{uiText("Профиль оператора")}</h1><p className="page-subtitle">{uiText("Ник и уровень приходят с экрана игры и из tarkov.dev, задания — из логов игры.")}</p></div>
      <span className="tag green"><ShieldCheck size={12} />{uiText(" только чтение")}</span>
    </header>
    <div className="profile-operator-layout">
      <NicknamePanel />
      <section className="panel profile-live-card">
        {/* The current nickname, never the name of a Tarkov.dev profile from before a rename (owner, 13.10.2026). */}
        <div className="panel-header"><div><div className="eyebrow">{uiText("Текущий профиль · ")}{uiText(modeName)}</div><div className="panel-title">{uiText(currentNickname ?? state.activeProfile.displayName)}</div></div>{uiText(snapshot?.upstreamUpdatedAt && <small className="dim">{uiText(new Date(snapshot.upstreamUpdatedAt).toLocaleString('ru-RU'))}</small>)}</div>
        {/* «Престиж +» and «Вайп» below it, next to the level: the mode shown starts again (owner, 15.10.2026). */}
        <div className="panel-body"><div className="profile-level-row"><PlayerLoadoutSummary snapshot={snapshot} level={progress.playerLevel} anchor={progress.levelAnchor} /><ModeResetButtons /></div><PrestigeLine level={progress.prestige} locale={locale} mode={state.raidMode} /></div>
        {owner && <div className="profile-live-footer"><a className="button primary" href={ACCOUNT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{uiText(" Личный кабинет")}</a></div>}
      </section>
    </div>
    {/* «Баннер для всех», «Объявления по регионам» and «Опросы» moved to «Админ панель» (owner, 16.10.2026). */}
    {owner && <MovedToAdminPanel what="Баннер для всех, объявления и опросы" tab="notices" />}
    {/* «Диагностика квестов»: what each quest source gave per mode (src/quests/questEngine.ts); players never see it. */}
    {owner && <QuestDiagnosticsPanel />}
    {accountBlock}
    {status?.kind === 'streamer' && <StreamerCabinetPanel />}
    {/* «Поддержать проект» next to the cabinet, as on the website (owner, 13.10.2026). */}
    <div className="profile-donate"><DonateCard /></div>
  </div>
}

/**
 * «Персонаж»: one Escape from Tarkov nickname for PvP, PvE and «Сезон» (owner, 10.10.2026), typed by the player with
 * «Сменить ник» (owner, 13.10.2026: «делай ручной ввод, не обращаясь к тарков дев», «возвращай кнопку сменить ник»).
 */
function NicknamePanel() {
  const nickname = useAccountNickname()
  return (
    <section className="panel profile-character-panel is-compact">
      <div className="panel-header"><div><div className="eyebrow">{uiText('Ник · PvP · PvE · Сезон')}</div><div className="panel-title">{nickname ?? uiText('Ник не указан')}</div></div><UserRound size={18} className="dim" /></div>
      <div className="panel-body">
        <p className="profile-nick-message">{uiText(nickname ? 'Один ник для PvP, PvE и Сезона. Его видят друзья и отряд.' : 'Ник увидят друзья и отряд.')}</p>
        <NicknameEditor />
      </div>
    </section>
  )
}
