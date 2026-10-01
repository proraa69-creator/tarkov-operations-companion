import { useState } from 'react'
import { CreditCard, ExternalLink, Globe, LogIn, LogOut, RefreshCw, Smartphone, UserRound } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useServerAccount } from '../sync/serverSync'
import { isDesktopShell } from '../platform'
import { openWebsite, subscriptionText } from './accountActions'
import { modeTitle, RAID_MODE_ORDER } from './nicknameBinding'
import { ApproveWebLoginDialog, MobileLoginDialog } from './QrDialogs'
import { openAccountSignIn } from './accountEvents'
import { PhoneCabinetRow } from './PhoneAccount'
import { EmailVerifyRow } from './EmailAccount'
import './account.css'

/**
 * «Личный кабинет» on the profile of the players' app (client build): the same as the website cabinet in short —
 * the account e-mail, the subscription, the nicknames per mode — plus opening the cabinet on the site, signing in on
 * the phone or in a browser by QR code, and signing out. The owner's build shows «Аккаунт сервера» instead.
 */
export function ClientCabinetPanel() {
  const { status, checking, refresh, logout } = useServerAccount()
  const state = useAppState()
  const [dialog, setDialog] = useState<'mobile' | 'approve' | null>(null)
  const desktop = isDesktopShell()
  const online = status?.online ?? false

  if (!status?.signedIn) {
    return (
      <section className="panel account-cabinet" aria-label={uiText('Личный кабинет')}>
        <div className="panel-header"><div className="panel-title"><UserRound size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Личный кабинет')}</div></div>
        <div className="panel-body stack">
          <p className="account-cabinet-note">{uiText(status && !online ? 'Сервер недоступен: приложение работает на этом компьютере без аккаунта. Войдите, когда сервер снова будет доступен.' : 'Вы не вошли в аккаунт.')}</p>
          <div className="account-cabinet-actions">
            <button className="button primary" onClick={openAccountSignIn}><LogIn size={14} />{uiText('Войти в аккаунт')}</button>
            <button className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить')}</button>
          </div>
        </div>
      </section>
    )
  }

  const subscription = status.subscription
  const good = subscription?.status === 'active' || subscription?.status === 'lifetime' || subscription?.status === 'trial'
  const nicknames = RAID_MODE_ORDER.map((mode) => {
    const local = state.activeProfile.modes[mode].registration
    return `${uiText(modeTitle(mode))}: ${(local.status === 'registered' ? local.nickname : status.nicknames?.[mode]) ?? '—'}`
  }).join(' · ')

  return (
    <section className="panel account-cabinet" aria-label={uiText('Личный кабинет')}>
      <div className="panel-header">
        <div className="panel-title"><UserRound size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Личный кабинет')}</div>
        <span className={`tag ${online ? 'green' : 'danger'}`}>{uiText(online ? 'Сервер доступен' : 'Сервер недоступен')}</span>
      </div>
      <div className="panel-body stack">
        <div className="account-cabinet-grid">
          <div className="account-cabinet-cell">
            <span>{uiText('Аккаунт')}</span>
            <strong>{status.email ?? '—'}</strong>
            <small>{uiText(status.kind === 'streamer' ? 'Стример' : 'Пользователь')}</small>
          </div>
          <div className={`account-cabinet-cell ${good ? 'is-good' : 'is-warn'}`}>
            <span>{uiText('Подписка')}</span>
            <strong>{uiText(subscriptionText(subscription))}</strong>
            <small>{uiText(subscription?.status === 'lifetime' ? 'Аккаунт стримера' : good ? 'Все функции доступны' : 'Оформить можно в личном кабинете на сайте')}</small>
          </div>
          <div className="account-cabinet-cell">
            <span>{uiText('Ники')}</span>
            <strong>{nicknames}</strong>
            <small>{uiText('Хранятся в аккаунте отдельно для каждого режима')}</small>
          </div>
          <PhoneCabinetRow phone={status.phone} online={online} />
          <EmailVerifyRow status={status} online={online} />
        </div>
        <div className="account-cabinet-actions">
          <button className="button primary" onClick={() => openWebsite('cabinet')}><ExternalLink size={14} />{uiText('Открыть кабинет на сайте')}</button>
          {subscription && !good && <button className="button" onClick={() => openWebsite('cabinet')}><CreditCard size={14} />{uiText('Оформить подписку')}</button>}
          {desktop && <button className="button" onClick={() => setDialog('mobile')}><Smartphone size={14} />{uiText('Войти в мобильную версию')}</button>}
          <button className="button ghost" onClick={() => setDialog('approve')}><Globe size={14} />{uiText('Подтвердить вход на сайте')}</button>
          <button className="button ghost" onClick={() => void refresh()} disabled={checking}><RefreshCw size={14} className={checking ? 'spin' : ''} />{uiText('Проверить')}</button>
          <button className="button danger" onClick={() => { if (window.confirm(uiText('Выйти из аккаунта на этом компьютере?'))) void logout() }}><LogOut size={14} />{uiText('Выйти')}</button>
        </div>
      </div>
      {dialog === 'mobile' && <MobileLoginDialog onClose={() => setDialog(null)} />}
      {dialog === 'approve' && <ApproveWebLoginDialog onClose={() => setDialog(null)} />}
    </section>
  )
}
