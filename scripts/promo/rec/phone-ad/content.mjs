// What the phone-apps ad says and shows besides the phone: the captions and pointer labels per language, and the stash of
// the item scene (real item pictures from tarkov.dev and the book the cursor goes to). Shared by build.mjs (the video)
// and stills.mjs (the pictures for posts).

export const TEXT = {
  ru: {
    hello: 'Дорогие друзья!', introTitle: 'Приложения Raid OS<br><em>для iOS и Android</em>', introSub: 'уже доступны для скачивания на сайте',
    chips: ['Квесты', 'Карты', 'Боссы', 'Барахолка'], chipTimes: [0.1, 0.55, 1.05, 1.45],
    tourEyebrow: 'Что внутри', tourTitle: 'Всё как на ПК —<br><em>всегда под рукой</em>',
    mapEyebrow: 'Клавиша скриншота на ПК', mapTitle: 'Карта открывается <em>сама</em>',
    itemEyebrow: 'Клавиша предмета на ПК', itemTitle: 'Что это и <em>сколько стоит</em>',
    testEyebrow: 'Тестируем каждый день', testTitle: 'Пишите нам, <em>что улучшить</em>', testSub: 'Прямо из приложения: «Ещё» → чат с поддержкой',
    illustration: 'Иллюстрация', compass: ['ЮЗ', 'З', 'СЗ'], stash: 'СХРОН', itemName: 'Потрепанная антикварная книга', itemKey: 'клавиша предмета', screenshotKey: 'скриншот',
    tagline: 'Меньше вкладок —<br><em>больше рейдов</em>', download: 'Скачать бесплатно:',
    disclaimer: 'Неофициальный фанатский проект. Escape from Tarkov — товарный знак Battlestate Games Limited. Проект не связан с Battlestate Games и не спонсируется ею.',
    pointers: { nav: 'Все разделы — внизу', map: 'Карта открылась сама', me: 'Вы здесь', hover: 'Наведите на предмет', price: 'Цены: барахолка и торговец', kappa: 'Нужен для Каппы', chat: 'Пишите нам здесь' },
  },
  en: {
    hello: 'Hey everyone!', introTitle: 'Raid OS apps<br><em>for iOS and Android</em>', introSub: 'now available to download on our website',
    chips: ['Quests', 'Maps', 'Bosses', 'Flea market'], chipTimes: [0.05, 0.42, 0.8, 1.3],
    tourEyebrow: 'What’s inside', tourTitle: 'Everything from your PC,<br><em>always at hand</em>',
    mapEyebrow: 'Screenshot key on the PC', mapTitle: 'The map opens <em>by itself</em>',
    itemEyebrow: 'Item key on the PC', itemTitle: 'What it is, <em>what it’s worth</em>',
    testEyebrow: 'Improving every day', testTitle: 'Tell us <em>what to improve</em>', testSub: 'Right in the app: More → Support chat',
    illustration: 'Illustration', compass: ['SW', 'W', 'NW'], stash: 'STASH', itemName: 'Battered antique book', itemKey: 'item key', screenshotKey: 'screenshot',
    tagline: 'Fewer tabs,<br><em>more raids</em>', download: 'Free download:',
    disclaimer: 'Unofficial fan project. Escape from Tarkov is a trademark of Battlestate Games Limited. This project is not affiliated with or sponsored by Battlestate Games.',
    pointers: { nav: 'Every section is down here', map: 'The map opened by itself', me: 'You are here', hover: 'Hover over an item', price: 'Prices: flea and trader', kappa: 'Needed for Kappa', chat: 'Message us here' },
  },
}

// The stash of the item scene: a few real item pictures (tarkov.dev assets) and the book the cursor goes to.
export const BOOK_ID = '5bc9c049d4351e44f824d360'
export const STASH = { 2: '544fb45d4bdc2dee738b4568', 5: '57347c5b245977448d35f6e1', 9: '59faff1d86f7746c51718c9c', 14: '590c5a7286f7747884343aea',
  19: '57347ca924597744596b4e71', 26: '57347c77245977448d35f6e2', 33: '5d0375ff86f774186372f685', 44: BOOK_ID, 50: '5c0530ee86f774697952d952', 61: '59e3577886f774176a362503' }
export const BOOK_CELL = 44
export const COLS = 13 // stage.html #cells

/** The stash grid for stage.html (picture per cell) and the book's cell, in screen pixels of the PC. */
export function stashParams() {
  const stash = Array.from({ length: COLS * 6 }, (_, i) => (STASH[i] ? `frames-icons/${STASH[i]}.webp` : ''))
  const bookCell = [(BOOK_CELL % COLS) * 66, Math.floor(BOOK_CELL / COLS) * 66].map((v, i) => v + [34, 80][i])
  return { stash, bookCell }
}
