/**
 * Owner settings that decide where money, one-time codes, error reports or server code go (payments, SMS, e-mail,
 * the public address, owner e-mails, error reports, server auto-update) change only after a native confirmation in
 * the main process (electron/main.ts): a compromised page cannot redirect them silently. Pure text building here
 * (unit-tested in ownerConfirm.test.ts); secrets are never shown in the dialog, only that they change.
 */
export type OwnerChange = 'payments' | 'sms' | 'email' | 'tunnel' | 'owner-emails' | 'error-reports' | 'server-update'

const TITLES: Record<OwnerChange, string> = {
  payments: 'Изменить настройки оплаты?',
  sms: 'Изменить настройки SMS-кодов?',
  email: 'Изменить настройки почты (коды подтверждения)?',
  tunnel: 'Изменить постоянный публичный адрес сервера?',
  'owner-emails': 'Изменить e-mail владельца?',
  'error-reports': 'Изменить отчёты об ошибках (GitHub)?',
  'server-update': 'Изменить автообновление сервера?',
}

const SECRET = /key|token|secret|password/i
const MAX_LINES = 14

function shown(value: unknown): string {
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 160)}…` : value || '(пусто)'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return '(пусто)'
  try { return shown(JSON.stringify(value)) } catch { return '(?)' }
}

/** One line per field: `name: value`; secrets as «будет заменён» / «будет удалён». */
function fieldLines(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [shown(payload)]
  const lines: string[] = []
  for (const [name, value] of Object.entries(payload as Record<string, unknown>)) {
    if (/^clear/i.test(name)) { if (value === true) lines.push(`${name}: будет удалён`); continue }
    if (SECRET.test(name)) { if (value) lines.push(`${name}: будет заменён (значение скрыто)`); continue }
    lines.push(`${name}: ${shown(value)}`)
  }
  return lines
}

export function ownerChangePrompt(change: OwnerChange, payload: unknown) {
  let lines: string[]
  if (change === 'tunnel') {
    const { hostname, token } = (payload ?? {}) as { hostname?: unknown; token?: unknown }
    lines = [`Адрес: ${shown(hostname)}`, ...(token ? ['Токен туннеля: будет заменён (значение скрыто)'] : [])]
  } else if (change === 'owner-emails') {
    lines = [`E-mail: ${shown(payload)}`]
  } else {
    lines = fieldLines(payload)
  }
  const visible = lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), `… и ещё ${lines.length - MAX_LINES}`] : lines
  return {
    message: TITLES[change],
    detail: `${visible.join('\n')}\n\nЕсли вы не меняли эти настройки сами, нажмите «Отмена».`,
  }
}
