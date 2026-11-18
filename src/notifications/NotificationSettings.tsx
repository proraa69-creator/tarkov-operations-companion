import type { ReactNode } from 'react'
import { ArrowLeftRight, Bell, Box, KeyRound, MessagesSquare, Sparkles, Store, Swords, Volume2 } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { setRaidStartNotice, useRaidStartNotice } from './raidStartNotice'
import { setNotificationOn, useNotificationKinds } from './notificationKinds'
import { useRestockSettings, writeRestockSettings } from '../restock/restockSettings'
import { useTradingSettings, writeTradingSettings } from '../trading/tradingSettings'
import { useQuestKeyReminder, writeQuestKeyReminder } from '../quests/questKeyFavorites'

interface Row { id: string; icon: ReactNode; title: string; note: string; on: boolean; set: (on: boolean) => void; sub?: boolean; disabled?: boolean }

function Switch({ row }: { row: Row }) {
  return <label className={`notification-setting${row.sub ? ' is-sub' : ''}${row.disabled ? ' is-disabled' : ''}`}>
    <span className="notification-setting-icon">{row.icon}</span>
    <span className="notification-setting-text"><strong>{uiText(row.title)}</strong><small>{uiText(row.note)}</small></span>
    <button type="button" role="switch" aria-checked={row.on} aria-label={uiText(row.title)} className={`toggle ${row.on ? 'on' : ''}`}
      disabled={row.disabled} onClick={() => row.set(!row.on)}><span /></button>
  </label>
}

/**
 * «Уведомления» → «Настроить» (owner, 18.11.2026): every notification of the app with its switch, the raid start with its sound.
 * The owner's own messages to the player (answers to reports, days granted) always come, so nothing of them is lost.
 */
export function NotificationSettings() {
  const raidStart = useRaidStartNotice()
  const kinds = useNotificationKinds()
  const restock = useRestockSettings()
  const trading = useTradingSettings()
  const questKeys = useQuestKeyReminder()
  const rows: Row[] = [
    { id: 'raid-start', icon: <Swords size={16} />, title: 'Рейд начался', note: 'Сообщение, когда закончилась загрузка рейда', on: raidStart, set: setRaidStartNotice },
    { id: 'raid-start-sound', icon: <Volume2 size={16} />, title: 'Звуковой сигнал', note: 'Звук, когда рейд начался', on: raidStart && kinds['raid-start-sound'], set: (on) => setNotificationOn('raid-start-sound', on), sub: true, disabled: !raidStart },
    { id: 'collector', icon: <Box size={16} />, title: 'Коллекционер', note: 'Итог распознавания предметов по клавише', on: kinds.collector, set: (on) => setNotificationOn('collector', on) },
    { id: 'restock', icon: <Store size={16} />, title: 'Ресток торговцев', note: 'Торговцы — в «Настройках»', on: restock.enabled, set: (on) => writeRestockSettings({ enabled: on }) },
    { id: 'trading', icon: <ArrowLeftRight size={16} />, title: 'Торговля', note: 'Цена упала, выросла, можно продавать', on: trading.enabled, set: (on) => writeTradingSettings({ enabled: on }) },
    { id: 'quest-keys', icon: <KeyRound size={16} />, title: 'Ключи для квестов', note: 'Напоминание о ключах в избранном', on: questKeys, set: writeQuestKeyReminder },
    { id: 'support', icon: <MessagesSquare size={16} />, title: 'Ответ поддержки', note: 'Новое сообщение в чате поддержки', on: kinds.support, set: (on) => setNotificationOn('support', on) },
    { id: 'app-updated', icon: <Sparkles size={16} />, title: 'Приложение обновлено', note: 'Новая версия загрузилась', on: kinds['app-updated'], set: (on) => setNotificationOn('app-updated', on) },
  ]
  return <div className="notification-settings">
    {rows.map((row) => <Switch key={row.id} row={row} />)}
    <p className="notification-settings-note"><Bell size={13} aria-hidden="true" />{uiText('Сообщения от Raid OS приходят всегда')}</p>
  </div>
}
