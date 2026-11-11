import { APP_STORE_BUILD, isIosApp } from '../platform'
import type { NewsEntry } from './newsState'

/**
 * The App Store app shows nothing about paying (owner, 12.11.2026: «проверь что бы в приложении не было упоминаний о
 * подписке»; docs/app-store/05-ios-build-done.md): a news line about a subscription, a payment, a price, a discount, a
 * trial or days given as a bonus is left out there, and a release left with nothing is left out too.
 */
export const PAYMENT_WORDS = /подписк|оплат|тариф|скидк|бонус|пробн|донат|Поддержать проект|Пригласи друга|Boosty|BZB|ЮKassa|ЮMoney|\+\s?\d+\s?(?:день|дн)|subscri|payment|\bpaid\b|\bpay\b|tariff|discount|bonus|trial|donat|support the project|invite a friend|YooKassa|YooMoney/i

export const storeSafeText = (text: string) => !PAYMENT_WORDS.test(text)

export function storeSafeNews(entries: readonly NewsEntry[]): NewsEntry[] {
  return entries
    .map((entry) => ({ ...entry, items: entry.items.filter((item) => storeSafeText(item.ru) && storeSafeText(item.en)) }))
    .filter((entry) => entry.items.length > 0)
}

/** The App Store build, or the iPhone app at all. */
export const appStoreRules = () => APP_STORE_BUILD || isIosApp()
