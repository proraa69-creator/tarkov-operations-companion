/**
 * English for «Чат с поддержкой» (src/support/SupportChat.tsx, src/support/supportChatClient.ts), its places in the
 * sidebar, Settings and the phone's «Ещё», the owner's «Заявки» → «Чаты» (src/support/OwnerChats.tsx) and the server's
 * chat errors (server/src/routes/supportChat.ts, services/supportChatStore.ts).
 */
export const SUPPORT_CHAT_PHRASES: Array<[string, string]> = [
  ['Чат с поддержкой', 'Support chat'],
  ['Напишите нам — ответим здесь же', 'Write to us and we will answer right here'],
  ['Войдите в аккаунт, чтобы написать нам', 'Sign in to message us'],
  ['Или напишите нам в Telegram', 'Or message us on Telegram'],
  ['Ваше сообщение…', 'Your message…'],
  ['Сообщение', 'Message'],
  ['Сообщения', 'Messages'],
  ['Отправить', 'Send'],
  ['Enter — отправить, Shift+Enter — новая строка', 'Enter to send, Shift+Enter for a new line'],
  ['Загружаем сообщения…', 'Loading messages…'],
  ['Отправлено', 'Sent'],
  ['Прочитано', 'Read'],
  ['Новых сообщений', 'New messages'],
  ['Новых уведомлений', 'New notifications'],
  ['Напишите нам в чат поддержки, отправьте отчёт об ошибке со скриншотами или поделитесь идеей для приложения.', 'Message us in the support chat, send a bug report with screenshots or share an idea for the app.'],
  // The app's and the server's refusals.
  ['Напишите сообщение', 'Write a message'],
  ['Сообщение длиннее 2000 символов', 'The message is longer than 2000 characters'],
  ['Слишком много сообщений. Подождите несколько минут.', 'Too many messages. Please wait a few minutes.'],
  ['Переписка не найдена', 'Conversation not found'],
  // «Заявки» → «Чаты» in the owner app.
  ['Чаты', 'Chats'],
  ['Загружаем чаты…', 'Loading chats…'],
  ['Переписок пока нет.', 'No conversations yet.'],
  ['Выберите переписку слева.', 'Choose a conversation on the left.'],
  ['Сообщений пока нет.', 'No messages yet.'],
  ['Ответ игроку…', 'Reply to the player…'],
  ['Все чаты', 'All chats'],
  ['Непрочитанных', 'Unread'],
]
