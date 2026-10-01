/**
 * English for the e-mail one-time codes: sign-in by a code from the e-mail, «Забыли пароль?» by e-mail and «Подтвердите
 * e-mail» (src/account/EmailAccount.tsx), the owner's «Почта: коды подтверждения» panel
 * (src/components/OwnerEmailPanel.tsx) and the server's messages for these flows (server/src/services/emailAuth.ts).
 */
export const EMAIL_PHRASES: Array<[string, string]> = [
  // Sign-in by code / password reset
  ['Войти по коду из письма', 'Sign in with an e-mail code'], ['Вход по коду из письма', 'Sign in with an e-mail code'],
  ['Сбросить пароль по SMS', 'Reset the password by SMS'],
  ['Введите e-mail аккаунта. Мы пришлём на него код для входа — пароль не нужен.', 'Enter your account e-mail. We will send a sign-in code to it, no password needed.'],
  ['Введите e-mail аккаунта. Мы пришлём на него код, после него задайте новый пароль.', 'Enter your account e-mail. We will send a code to it, then set a new password.'],
  ['Если такой аккаунт есть, на этот e-mail придёт письмо с кодом. Проверьте папку «Спам». Никому не сообщайте код.', 'If there is such an account, an e-mail with a code is on its way. Check the spam folder. Never share the code with anyone.'],
  ['Код из письма', 'Code from the e-mail'], ['Код из письма — 6 цифр', 'The e-mail code has 6 digits'], ['Другой e-mail', 'Another e-mail'],
  ['Обновите приложение: вход по коду из письма появился в новой версии', 'Update the app: e-mail code sign-in arrived in a newer version'],
  // Cabinet
  ['Подтвердите e-mail', 'Confirm your e-mail'], ['E-mail подтверждён', 'E-mail confirmed'], ['Отправить код', 'Send a code'],
  ['Мы пришлём на этот адрес код из 6 цифр. Подтверждённый e-mail нужен, чтобы восстановить доступ к аккаунту.', 'We will send a 6-digit code to this address. A confirmed e-mail lets you recover access to your account.'],
  // Server messages
  ['Коды на e-mail сейчас недоступны. Войдите по e-mail и паролю.', 'E-mail codes are not available right now. Sign in with your e-mail and password.'],
  ['Отправка писем временно недоступна. Попробуйте позже.', 'Sending e-mails is temporarily unavailable. Try again later.'],
  ['Срок подтверждения истёк. Зарегистрируйтесь ещё раз.', 'The confirmation has expired. Please register again.'],
  ['Слишком много запросов кода с этого адреса. Попробуйте завтра.', 'Too many code requests from this address. Try tomorrow.'],
  ['Для этого адреса исчерпан лимит кодов на сутки. Попробуйте завтра.', 'This e-mail has used up its codes for today. Try tomorrow.'],
  ['Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.', 'We sent a code to your e-mail. Enter it to finish signing up.'],
  ['E-mail уже подтверждён', 'The e-mail is already confirmed'],
  ['Не удалось отправить письмо. Попробуйте позже.', 'Could not send the e-mail. Try again later.'],
  ['Укажите корректный e-mail', 'Enter a valid e-mail'],
  // Owner: «Почта: коды подтверждения»
  ['Почта: коды подтверждения', 'E-mail: confirmation codes'],
  ['Выключено: регистрация без подтверждения e-mail, вход и восстановление по коду из письма скрыты', 'Off: sign-up without e-mail confirmation; e-mail code sign-in and recovery are hidden'],
  ['Коды для подтверждения e-mail при регистрации, входа по коду из письма и восстановления пароля. Ключ хранится на этом компьютере в зашифрованном виде и больше не показывается. Эти настройки есть только здесь, не на сайте. Подробности: docs/email-codes.md.', 'Codes for confirming the e-mail at sign-up, signing in with an e-mail code and recovering the password. The key is stored encrypted on this PC and never shown again. These settings exist only here, not on the website. Details: docs/email-codes.md.'],
  ['Почтовый сервис', 'E-mail service'], ['API-ключ', 'API key'], ['Отправитель (From)', 'Sender (From)'],
  ['re_… (Resend → API Keys, доступ Sending access)', 're_… (Resend → API Keys, Sending access)'],
  ['Домен отправителя (raidos.app) должен быть подтверждён в Resend, иначе письма не уйдут.', 'The sender domain (raidos.app) must be verified in Resend, otherwise e-mails are not sent.'],
  ['Лимит писем в сутки', 'E-mails per day limit'],
  ['Защита от рассылки через форму регистрации: после лимита письма не отправляются до следующих суток, вход по паролю работает как обычно.', 'Protection against abuse of the sign-up form: after the limit no e-mails are sent until the next day; password sign-in works as usual.'],
  ['Тестовое письмо на адрес', 'Test e-mail to'], ['Отправить тестовое письмо', 'Send a test e-mail'], ['Тестовое письмо отправлено', 'Test e-mail sent'],
  ['Неизвестный почтовый сервис', 'Unknown e-mail service'],
  ['Адрес отправителя: «Raid OS <noreply@raidos.app>» или просто noreply@raidos.app', 'Sender: «Raid OS <noreply@raidos.app>» or just noreply@raidos.app'],
  ['Ключ Resend начинается с re_ и копируется целиком, без пробелов', 'A Resend key starts with re_; copy it whole, without spaces'],
  ['Лимит писем в сутки: целое число от 1 до 1 000 000', 'E-mails per day: a whole number from 1 to 1 000 000'],
  ['Дневной лимит писем исчерпан', 'The daily e-mail limit is used up'], ['Почта не настроена', 'E-mail is not set up'],
]
