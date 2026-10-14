/** English strings for the owner's ЮKassa autopayment setting (OwnerPanels.tsx) and «Ошибка сервера: N» of the owner API (electron/ownerAdmin.ts). */
export const PAYMENT_PHRASES: Array<[string, string]> = [
  ['Автоплатежи ЮKassa включены', 'YooKassa autopayments on'],
  ['Включайте только после того, как менеджер ЮKassa подключил автоплатежи для магазина. Тогда в кабинете появится отдельная галочка согласия на автоматическое списание; без неё платёж разовый. Списание — за сутки до конца оплаченного срока, до 3 попыток.', 'Switch on only after your YooKassa manager has enabled autopayments for the shop. The cabinet then shows a separate consent checkbox for automatic charges; without it a payment is one-off. The charge happens a day before the paid period ends, up to 3 attempts.'],
  ['Ошибка сервера', 'Server error'],
]
