/**
 * English for «Чат с поддержкой» (src/support/SupportChat.tsx, src/support/supportChatClient.ts) with its screenshots and
 * «Написать в Telegram», its places in the sidebar, Settings and the phone's «Ещё», its toast, the owner's «Заявки» → «Чаты» (src/support/OwnerChats.tsx, «Открыть
 * чат» in src/pages/RequestsPage.tsx) and the server's chat errors (server/src/routes/supportChat.ts,
 * services/supportChatStore.ts).
 */
import { SUPPORT_IMAGE_PLACEHOLDER } from '../shared/supportChat'

export const SUPPORT_CHAT_PHRASES: Array<[string, string]> = [
  ['Чат с поддержкой', 'Support chat'],
  ['Напишите нам — ответим здесь же', 'Write to us and we will answer right here'],
  ['Войдите в аккаунт, чтобы написать нам', 'Sign in to message us'],
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
  // The toast when an answer arrives while the chat is closed (owner, 14.10.2026).
  ['Новое сообщение от поддержки', 'New message from support'],
  ['Открыть', 'Open'],
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
  // «Открыть чат» on a report and «Проблема решена» (owner, 14.10.2026).
  ['Открыть чат', 'Open chat'],
  ['Проблема решена', 'Problem solved'],
  ['Удалить переписку?', 'Delete the conversation?'],
  ['Да', 'Yes'],
  ['Нет', 'No'],
  // One entry and Telegram inside the chat (owner, 15.10.2026).
  ['Удобнее в Telegram?', 'Prefer Telegram?'],
  // Screenshots in the chat (owner, 15.10.2026).
  [SUPPORT_IMAGE_PLACEHOLDER, '[screenshot]'],
  ['Скриншот', 'Screenshot'],
  ['Открыть скриншот', 'Open screenshot'],
  ['Скриншот недоступен', 'Screenshot unavailable'],
  ['Загружаем скриншот…', 'Loading the screenshot…'],
  ['Скриншоты к сообщению', 'Screenshots for the message'],
  ['Готовим скриншот…', 'Preparing the screenshot…'],
  ['Прикрепить скриншот', 'Attach a screenshot'],
  ['Прикрепить скриншот: до 4 изображений PNG, JPEG или WEBP, каждое до 5 МБ. Можно вставить из буфера (Ctrl+V) или перетащить в окно.', 'Attach a screenshot: up to 4 PNG, JPEG or WEBP images, up to 5 MB each. You can also paste one (Ctrl+V) or drop it on the window.'],
  ['Не больше 4 скриншотов.', 'No more than 4 screenshots.'],
  ['Не больше 4 скриншотов', 'No more than 4 screenshots'],
  ['Enter — отправить, Shift+Enter — новая строка, Ctrl+V — вставить скриншот', 'Enter to send, Shift+Enter for a new line, Ctrl+V to paste a screenshot'],
  ['Хранилище скриншотов сейчас заполнено. Отправьте сообщение без скриншотов.', 'Screenshot storage is full right now. Please send the message without screenshots.'],
  ['Слишком много скриншотов. Попробуйте через час.', 'Too many screenshots. Please try again in an hour.'],
  ['Скриншот не найден', 'Screenshot not found'],
  ['Сервер сейчас принимает другие скриншоты. Повторите через несколько секунд.', 'The server is receiving other screenshots right now. Please try again in a few seconds.'],
]
