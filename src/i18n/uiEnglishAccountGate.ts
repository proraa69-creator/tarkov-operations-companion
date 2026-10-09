/**
 * English for the account window's «Вход» / «Регистрация» (src/account/AccountSignIn.tsx) and the server's messages
 * for registration (server/src/services/accountStore.ts, emailAuth.ts).
 */
export const ACCOUNT_GATE_PHRASES: Array<[string, string]> = [
  ['Зарегистрироваться', 'Sign up'], ['Уже есть аккаунт?', 'Already have an account?'],
  ['Вход по QR-коду: в приложении на компьютере откройте Профиль → «Войти в мобильную версию» и наведите камеру телефона на QR-код.', 'QR sign-in: in the PC app open Profile → «Sign in on the phone» and point the phone camera at the QR code.'],
  ['Один аккаунт для сайта и приложения: ники, прогресс заданий и подписка хранятся в нём.', 'One account for the website and the app: your nicknames, task progress and subscription are kept in it.'],
  ['Код приглашения (необязательно)', 'Invitation code (optional)'], ['У меня есть код приглашения', 'I have an invitation code'],
  ['Код друга — скидка 20 % на первый месяц.', 'A friend’s code gives 20% off the first month.'],
  ['Создаём аккаунт…', 'Creating the account…'], ['Подтвердить и войти', 'Confirm and sign in'],
  ['Код из 6 цифр действует 10 минут. Не пришло письмо — проверьте папку «Спам».', 'The 6-digit code works for 10 minutes. No e-mail? Check the Spam folder.'],
  ['Пароль должен быть не короче 8 символов.', 'The password must be at least 8 characters long.'], ['Пароли не совпадают.', 'The passwords do not match.'],
  ['Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».', 'Invitation code: 3–24 characters, Latin letters, digits, «_» or «-».'],
  ['Отметьте согласие с офертой и на обработку персональных данных.', 'Tick the consent to the offer and to the processing of personal data.'],
  ['Обновите приложение: регистрация в приложении появилась в новой версии', 'Update the app: signing up in the app arrived in a newer version'],
  // Server messages
  ['Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.', 'We sent a code to your e-mail. Enter it to finish signing up.'],
  ['Не удалось зарегистрировать этот e-mail. Если это ваш адрес — войдите или восстановите пароль.', 'This e-mail could not be registered. If it is yours, sign in or recover your password.'],
  ['Этот e-mail уже зарегистрирован', 'This e-mail is already registered'],
  ['Укажите корректный e-mail и пароль от 8 до 128 символов', 'Enter a valid e-mail and a password of 8 to 128 characters'],
]
