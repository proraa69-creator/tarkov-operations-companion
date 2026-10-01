import { uiText } from '../i18n/renderText'

/** «N с назад» / «N s ago», minutes and hours for older checks. */
export function agoText(at: number | undefined, now: number, locale: 'ru' | 'en') {
  if (!at) return locale === 'en' ? 'not checked yet' : 'ещё не проверялось'
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  const value = seconds < 60 ? `${seconds} ${locale === 'en' ? 's' : 'с'}` : seconds < 3600 ? `${Math.floor(seconds / 60)} ${locale === 'en' ? 'min' : 'мин'}` : `${Math.floor(seconds / 3600)} ${locale === 'en' ? 'h' : 'ч'}`
  return locale === 'en' ? `last check ${value} ago` : `последняя проверка ${value} назад`
}

const LABELS_EN: Array<[RegExp, string]> = [[/^Сервер \(API\)/, 'Server (API)'], [/^Сайт/, 'Website'], [/^Публичный адрес/, 'Public address'], [/^База данных/, 'Database']]
const DYNAMIC_EN: Array<[RegExp, string]> = [
  [/автоматический перезапуск \(попытка (\d+)\)/g, 'automatic restart (attempt $1)'],
  [/не удалось починить после (\d+) попыток/g, 'could not repair after $1 attempts'],
  [/Автоматический перезапуск не помог \((\d+) попытки\)\./g, 'Automatic restart did not help ($1 attempts).'],
  [/Приложение будет пробовать дальше раз в 5 минут\./g, 'The app keeps trying every 5 minutes.'],
  [/Пробую починить автоматически\./g, 'Trying to repair it automatically.'],
  [/перезапуск не удался — /g, 'restart failed — '],
  [/Сервер остановился с кодом (\d+)\. Журнал:/g, 'The server stopped with code $1. Log:'],
  [/Порт (\d+) занят старым сервером \(сборка ([^)]*\)?)\)\./g, 'Port $1 is held by an old server (build $2).'],
  [/Порт (\d+) занят другой программой, которая не отвечает как сервер\./g, 'Port $1 is held by another program that does not answer as the server.'],
  [/Порт (\d+) занят другой программой/g, 'Port $1 is held by another program'],
  [/Нажмите «Перезапустить сейчас»\./g, 'Press “Restart now”.'],
  [/Сервер ответил с ошибкой \(HTTP (\d+)\)\./g, 'The server answered with an error (HTTP $1).'],
  [/Сайт ответил HTTP (\d+)\./g, 'The website answered HTTP $1.'],
  [/ отвечает HTTP (\d+)\./g, ' answers HTTP $1.'],
  [/ не открывается из интернета: /g, ' does not open from the internet: '],
  [/нет ответа \(тайм-аут\)/g, 'no answer (timeout)'],
  [/Сервер не отвечает/g, 'The server does not answer'], [/Сайт не отвечает/g, 'The website does not answer'],
  [/cloudflared сообщает об ошибках: /g, 'cloudflared reports errors: '], [/нет связи с Cloudflare/g, 'no connection to Cloudflare'],
  [/Туннель остановился \(код ([^)]*)\)\./g, 'The tunnel stopped (code $1).'],
  [/неизвестная \(старая\)/g, 'unknown (old)'], [/: перезапуск вручную/g, ': manual restart'], [/: снова работает после перезапуска/g, ': working again after a restart'],
  [/: снова работает/g, ': working again'], [/: не работает/g, ': down'], [/: не удалось починить/g, ': could not repair'], [/: перезапущено автоматически/g, ': restarted automatically'],
  [/ снова работает\./g, ' works again.'], [/Откройте журнал /g, 'Open the log '], [/ или перезапустите приложение\./g, ' or restart the app.'],
  [/Перезапустите приложение; если порт 5202 занят — закройте другую программу\./g, 'Restart the app; if port 5202 is taken, close the other program.'],
  [/Проверьте интернет на этом компьютере и туннель в панели Cloudflare\./g, 'Check the internet on this PC and the tunnel in the Cloudflare dashboard.'],
]

/** Watchdog texts come from the main process in Russian; fixed ones are in the phrase list, the rest is patterned. */
export function watchdogText(text: string, locale: 'ru' | 'en') {
  if (locale !== 'en') return text
  const exact = uiText(text)
  if (exact !== text && !/[а-яё]/i.test(exact)) return exact
  let result = text
  for (const [pattern, english] of LABELS_EN) result = result.replace(pattern, english)
  for (const [pattern, english] of DYNAMIC_EN) result = result.replace(pattern, english)
  return /[а-яё]/i.test(result) ? uiText(result) : result
}

