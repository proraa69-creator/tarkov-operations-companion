/**
 * English for «Доступ Claude к заявкам» in the owner app (src/requests/ClaudeAccessPanel.tsx) and for the server's
 * answers to it (server/src/routes/agentRequests.ts).
 */
export const REQUESTS_KEY_PHRASES: Array<[string, string]> = [
  ['Доступ Claude к заявкам', 'Claude’s access to requests'],
  ['Ключ только для чтения заявок: тексты, скриншоты, версии. Почт и аккаунтов в нём нет.', 'A read-only key for the requests: texts, screenshots, versions. No e-mails or accounts in it.'],
  ['Проверяем ключ…', 'Checking the key…'],
  ['Ключа нет', 'No key'],
  ['Ключ создан', 'Key created'],
  ['последнее чтение', 'last read'],
  ['ещё не использовался', 'not used yet'],
  ['Создать ключ', 'Create key'],
  ['Заменить ключ', 'Replace key'],
  ['Заменить ключ? Старый ключ сразу перестанет работать.', 'Replace the key? The old key stops working at once.'],
  ['Отозвать', 'Revoke'],
  ['Ключ отозван', 'Key revoked'],
  ['Новый ключ', 'New key'],
  ['Скрыть ключ', 'Hide key'],
  ['Добавьте его в настройки облачной среды Claude как RAIDOS_REQUESTS_KEY (меню среды в заголовке сессии → Edit → Network secrets). В чат ключ не вставляйте.', 'Add it to the Claude cloud environment settings as RAIDOS_REQUESTS_KEY (the environment menu in the session header → Edit → Network secrets). Do not paste the key into the chat.'],
  ['Ключ показан один раз: после закрытия панели его не увидеть.', 'The key is shown once: after the panel closes it cannot be seen again.'],
  ['Не удалось скопировать: выделите ключ и нажмите Ctrl+C.', 'Could not copy: select the key and press Ctrl+C.'],
  ['Войдите в аккаунт владельца, чтобы управлять ключом.', 'Sign in to the owner account to manage the key.'],
  ['Ключом управляет только аккаунт владельца. Войдите в него в профиле.', 'Only the owner account manages the key. Sign in to it in the profile.'],
  // The server's refusals.
  ['Требуется вход в аккаунт', 'Sign-in required'],
  ['Слишком много запросов. Подождите минуту.', 'Too many requests. Please wait a minute.'],
]
