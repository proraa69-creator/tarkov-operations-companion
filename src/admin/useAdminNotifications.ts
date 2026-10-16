import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { adminApi, type AdminPayment, type PaymentStatus } from './adminApi'

const SNAPSHOT_KEY = 'raidos-owner-mobile-notifications-v1'
const POLL_MS = 45_000

interface Snapshot { users: number; openReports: number; payments: Record<string, PaymentStatus> }

function readSnapshot(): Snapshot | null {
  try {
    const value = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null') as Partial<Snapshot> | null
    if (!value || !Number.isFinite(value.users) || !Number.isFinite(value.openReports) || !value.payments || typeof value.payments !== 'object') return null
    return { users: Number(value.users), openReports: Number(value.openReports), payments: value.payments as Record<string, PaymentStatus> }
  } catch { return null }
}

function saveSnapshot(snapshot: Snapshot) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot)) } catch { /* private mode */ }
}

async function notify(title: string, body: string) {
  if (Capacitor.isNativePlatform()) {
    let permission = await LocalNotifications.checkPermissions()
    if (permission.display === 'prompt') permission = await LocalNotifications.requestPermissions()
    if (permission.display !== 'granted') return
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2_000_000_000), title, body, smallIcon: 'ic_stat_icon_config_sample' }] })
    return
  }
  if (!('Notification' in window)) return
  let permission = Notification.permission
  if (permission === 'default') permission = await Notification.requestPermission()
  if (permission === 'granted') new Notification(title, { body, tag: `raidos-admin-${title}` })
}

function paymentNotice(payment: AdminPayment, previous?: PaymentStatus) {
  if (payment.status === 'succeeded' && previous !== 'succeeded') return { title: 'Raid OS · Новая оплата', body: `${payment.email} · ${payment.plan} · ${payment.amount} ₽` }
  if (previous === undefined && payment.status === 'pending') return { title: 'Raid OS · Попытка оплаты', body: `${payment.email} · ${payment.plan}` }
  return null
}

/** Foreground polling. Native notifications arrive while the app is running or returns to the foreground. */
export function useAdminNotifications(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let active = true
    let busy = false

    const check = async () => {
      if (!active || busy) return
      busy = true
      try {
        const [overview, paymentList, reports] = await Promise.all([adminApi.overview(), adminApi.payments('all', 'all', 40), adminApi.bugReports('open', 1)])
        if (!active) return
        const previous = readSnapshot()
        const next: Snapshot = { users: overview.users.total, openReports: reports.counts.open, payments: Object.fromEntries(paymentList.payments.map((payment) => [payment.id, payment.status])) }
        saveSnapshot(next)
        if (!previous) return
        const newUsers = Math.max(0, next.users - previous.users)
        if (newUsers) await notify('Raid OS · Новый аккаунт', newUsers === 1 ? 'Зарегистрировался новый пользователь' : `Новых пользователей: ${newUsers}`)
        const newReports = Math.max(0, next.openReports - previous.openReports)
        if (newReports) await notify('Raid OS · Новая заявка', newReports === 1 ? 'Поступило новое обращение' : `Новых обращений: ${newReports}`)
        for (const payment of [...paymentList.payments].reverse()) {
          const notice = paymentNotice(payment, previous.payments[payment.id])
          if (notice) await notify(notice.title, notice.body)
        }
      } catch { /* offline or a revoked owner session: try again after resume/poll */ }
      finally { busy = false }
    }

    void check()
    const timer = window.setInterval(() => void check(), POLL_MS)
    const visible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [enabled])
}
