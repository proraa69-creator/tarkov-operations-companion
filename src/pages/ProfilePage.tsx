import { NicknameEditor } from '../account/NicknameEditor'
import { uiText } from '../i18n/renderText'
import { ExternalLink } from 'lucide-react'
import { ACCOUNT_URL } from '../shared/links'
import { PlayerLoadoutSummary } from '../components/PlayerLoadoutSummary'
import { useAppState } from '../state/AppState'
import { ServerAccountPanel } from '../components/ServerAccountPanel'
import { isOwnerApp } from '../app/buildEdition'
import { ClientCabinetPanel } from '../account/ClientCabinetPanel'
import { StreamerCabinetPanel } from '../account/StreamerCabinetPanel'
import { useServerAccount, usesWebAccount } from '../sync/serverSync'
import { useAccountNickname } from '../account/useAccountNickname'
import { outdatedProfile } from '../account/logNickname'
import { MovedToAdminPanel } from '../admin/MovedToAdminPanel'
import { DonateCard } from '../components/DonateCard'
import { ModeResetButtons, PrestigeLine } from '../components/PrestigeResetButton'
import { useLocale } from '../i18n/LocaleProvider'
import { isIosApp, useMobileLayout } from '../platform'
import { AccountDeletionPanel, IosAccountPanel } from '../account/IosAccount'
import { AppleSubscriptionPanel } from '../account/AppleSubscription'
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
  // The iPhone app (App Store build): the account without the website cabinet, payments or partner payouts, with
  // «Удалить аккаунт» and the privacy policy (src/account/IosAccount.tsx).
  const ios = isIosApp()
  // The phone: the character and the account are one block, the level beside the mode instead of its big frame (owner,
  // 07.11.2026: «все в один блок соедини и оформи аккуратно»).
  const mobile = useMobileLayout()
  const oneBlock = mobile && !owner && Boolean(status?.signedIn)
  const online = status?.online ?? false
  const shownLevel = snapshot || progress.levelAnchor ? progress.playerLevel ?? snapshot?.level : undefined
  const blockButtons = <><ModeResetButtons /><NicknameEditor /></>
  const accountBlock = oneBlock ? (ios ? <><AppleSubscriptionPanel /><AccountDeletionPanel /></> : null) : owner && !ios
    ? <ServerAccountPanel />
    : usesWebAccount() && !status?.signedIn ? <ServerAccountPanel /> : ios ? <IosAccountPanel /> : <ClientCabinetPanel />

  return <div className="page profile-page">
    <header className="page-header">
      <div><div className="eyebrow">{uiText(owner ? 'Локальная учётная запись' : 'Аккаунт')}</div><h1 className="page-title">{uiText("Профиль оператора")}</h1><p className="page-subtitle">{uiText("Ник и уровень приходят с экрана игры, задания — из логов игры.")}</p></div>
    </header>
    {/* No block of its own (owner, 01.11.2026, crossed out): the nickname stands in «Текущий профиль», «Поменять ник» beside the level (06.11.2026). */}
    <div className="profile-operator-layout">
      {oneBlock ? <section className="panel profile-live-card profile-one-block">
        <div className="panel-header">
          <div>
            <div className="eyebrow">{uiText(modeName)}{shownLevel ? <> · {uiText('Уровень ')}{shownLevel}</> : null}</div>
            <div className="panel-title">{uiText(currentNickname ?? state.activeProfile.displayName)}</div>
          </div>
          <span className={`tag ${online ? 'green' : 'danger'}`}>{uiText(online ? 'Сервер доступен' : 'Сервер недоступен')}</span>
        </div>
        <div className="panel-body stack">
          {!shownLevel && <PlayerLoadoutSummary snapshot={snapshot} level={progress.playerLevel} anchor={progress.levelAnchor} />}
          <PrestigeLine level={progress.prestige} locale={locale} mode={state.raidMode} />
          {ios ? <IosAccountPanel buttons={blockButtons} /> : <ClientCabinetPanel buttons={blockButtons} />}
        </div>
      </section> : <section className="panel profile-live-card">
        {/* The current nickname, never the name of a Tarkov.dev profile from before a rename (owner, 13.10.2026). */}
        <div className="panel-header"><div><div className="eyebrow">{uiText("Текущий профиль · ")}{uiText(modeName)}</div><div className="panel-title">{uiText(currentNickname ?? state.activeProfile.displayName)}</div></div>{uiText(snapshot?.upstreamUpdatedAt && <small className="dim">{uiText(new Date(snapshot.upstreamUpdatedAt).toLocaleString('ru-RU'))}</small>)}</div>
        {/* «Вайп / Престиж» and «Сброс» below it, next to the level (owner, 15.10 and 04.11.2026). */}
        <div className="panel-body"><div className="profile-level-row"><PlayerLoadoutSummary snapshot={snapshot} level={progress.playerLevel} anchor={progress.levelAnchor} /><div className="profile-level-actions"><ModeResetButtons /><NicknameEditor /></div></div><PrestigeLine level={progress.prestige} locale={locale} mode={state.raidMode} /></div>
        {owner && <div className="profile-live-footer"><a className="button primary" href={ACCOUNT_URL} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{uiText(" Личный кабинет")}</a></div>}
      </section>}
    </div>
    {/* «Баннер для всех», «Объявления по регионам» and «Опросы» moved to «Админ панель» (owner, 16.10.2026). */}
    {owner && <MovedToAdminPanel what="Баннер для всех, объявления и опросы" tab="notices" />}
    {/* «Диагностика квестов»: what each quest source gave per mode (src/quests/questEngine.ts); players never see it. */}
    {owner && <QuestDiagnosticsPanel />}
    {accountBlock}
    {status?.kind === 'streamer' && !ios && <StreamerCabinetPanel />}
    {/* «Поддержать проект» next to the cabinet, as on the website (owner, 13.10.2026); not in the App Store build. */}
    {!ios && <div className="profile-donate"><DonateCard /></div>}
  </div>
}

