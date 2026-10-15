/**
 * English for «Укажите страну» (src/account/CountryGate.tsx, src/components/CountryPicker.tsx) and the server's answers
 * to it (server/src/services/accountStore.ts setInitialCountry).
 */
export const NOTICE_PHRASES: Array<[string, string]> = [
  ['Укажите страну', 'Please select your country'],
  ['Нужна для правильного языка уведомлений и поддержки. Без неё приложением пользоваться нельзя.', 'We need it to send notifications and support in the right language. The app cannot be used without it.'],
  ['Поиск страны', 'Search countries'],
  ['Начните вводить название', 'Start typing a name'],
  ['Страны', 'Countries'],
  ['Ничего не найдено', 'Nothing found'],
  ['Моей страны нет в списке — ввести вручную', 'My country is not listed — type it in'],
  ['Название страны', 'Country name'],
  ['Только буквы, пробелы и дефисы, до 60 символов.', 'Letters, spaces and hyphens only, up to 60 characters.'],
  ['Есть в списке:', 'Listed as:'],
  ['Выбрать из списка', 'Choose from the list'],
  ['Выйти из аккаунта', 'Sign out'],
  ['Название страны: до 60 символов, только буквы, пробелы и дефисы.', 'Country name: up to 60 characters, letters, spaces and hyphens only.'],
  ['Страна уже указана. Изменить её можно в личном кабинете.', 'The country is already set. You can change it in your account on the website.'],
]
