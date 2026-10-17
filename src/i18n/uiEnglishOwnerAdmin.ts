/** English strings for the site admin link and the server sign-in hints (src/components/ServerAccountPanel.tsx). */
export const OWNER_ADMIN_PHRASES: Array<[string, string]> = [
  ['Открыть админ-панель', 'Open admin panel'],
  ['Вход на сервер:', 'Signing in to server:'],
  ['этот компьютер', 'this PC'],
  ['Это игровой компьютер, а сервер работает на ноутбуке (raidos.app)? Выключите этот переключатель — приложение подключится к raidos.app, и вход с вашим e-mail заработает.', 'Is this your gaming PC while the server runs on the laptop (raidos.app)? Switch this off: the app connects to raidos.app and signing in with your e-mail works.'],
]

/**
 * «Онлайн сейчас» under «Ваши предложения» in the owner app (src/components/OwnerOnlineLine.tsx): templates with the
 * counts, applied before the phrase table (uiEnglish.ts translateUiText).
 */
export const OWNER_ADMIN_RULES: Array<[RegExp, string]> = [
  [/^Онлайн сейчас: (\d+)$/g, 'Online now: $1'],
  [/^ПК (\d+)$/g, 'PC $1'],
  [/^телефон (\d+)$/g, 'phone $1'],
  [/^Аккаунты в приложении для ПК или телефона за последние (\d+) мин\.$/g, 'Accounts in the PC or phone app within the last $1 min.'],
]
