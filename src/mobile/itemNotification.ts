/**
 * The item the player looked up in the raid as the phone's own notification (owner, 18.10.2026: «сделай что бы они
 * высвечивались как уведомление сверху, как на телефонах, не просто окно в карте»): the system banner at the top of the
 * screen, with the app open too (iOS `foreground`, Android a high-importance channel: heads-up). The next item replaces
 * it (one id). Without the permission, or in a browser, PhoneItemToast shows its own banner instead.
 */
import { LocalNotifications } from '@capacitor/local-notifications'
import { uiText } from '../i18n/renderText'
import type { ItemOverlayInfo } from '../overlay/types'
import { isAndroidApp, isNative } from '../platform'
import { formatPrice } from '../shared/format'

const CHANNEL_ID = 'raidos-item-info'
/** One notification for the item info: a new item replaces the last one instead of piling up. */
const NOTIFICATION_ID = 7301

type ItemCard = Pick<ItemOverlayInfo, 'name' | 'shortName' | 'kappa' | 'mate' | 'mateNames' | 'fleaPrice' | 'fleaAverage' | 'bestTrader' | 'quests'>

/** Title and text of the notification: the item, its prices and which quests (or friends) still need it. */
export function itemNotificationText(item: ItemCard) {
  const tags = [item.kappa ? uiText('Каппа') : '', item.mate ? uiText(item.mateNames?.length ? item.mateNames.join(', ') : 'Друг') : ''].filter(Boolean)
  const title = `${uiText(item.name || item.shortName || '')}${tags.length ? ` · ${tags.join(' · ')}` : ''}`
  const prices = [
    item.fleaPrice !== undefined ? `${uiText(item.fleaAverage ? 'Барахолка (сред.)' : 'Барахолка')} ${formatPrice(item.fleaPrice)}` : '',
    item.bestTrader ? `${uiText(item.bestTrader.name)} ${formatPrice(item.bestTrader.price)}` : '',
  ].filter(Boolean)
  const needs = [
    ...item.quests.slice(0, 3).map((quest) => `${uiText(quest.name)}${quest.count > 1 ? ` ×${quest.count}` : ''}`),
    ...(item.quests.length > 3 ? [`+${item.quests.length - 3}`] : []),
  ]
  const lines = [prices.length ? prices.join(' · ') : uiText('Цена неизвестна'), needs.length ? `${uiText('Нужен: ')}${needs.join(' · ')}` : '']
  return { title, body: lines.filter(Boolean).join('\n') }
}

let ready: Promise<boolean> | null = null

/** Asks for the permission once (the app's start on the phone) and makes the Android channel; false: not available. */
export function prepareItemNotifications(): Promise<boolean> {
  if (!isNative()) return Promise.resolve(false)
  ready ??= (async () => {
    try {
      let permission = await LocalNotifications.checkPermissions()
      if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') permission = await LocalNotifications.requestPermissions()
      if (permission.display !== 'granted') return false
      // Importance 5 (high): Android shows it as a banner over the screen, not only as an icon in the status bar.
      if (isAndroidApp()) await LocalNotifications.createChannel({ id: CHANNEL_ID, name: uiText('Информация о предмете'), description: uiText('Предмет, который вы посмотрели в рейде на ПК'), importance: 5, visibility: 1, vibration: true })
      return true
    } catch {
      return false
    }
  })()
  return ready
}

/** Shows the item as a system notification; false when the phone cannot (PhoneItemToast shows its banner then). */
export async function showItemNotification(item: ItemCard): Promise<boolean> {
  if (!await prepareItemNotifications()) return false
  try {
    const { title, body } = itemNotificationText(item)
    await LocalNotifications.schedule({
      notifications: [{ id: NOTIFICATION_ID, title, body, largeBody: body, channelId: CHANNEL_ID, foreground: true, autoCancel: true, group: 'raidos-item-info' }],
    })
    return true
  } catch {
    return false
  }
}
