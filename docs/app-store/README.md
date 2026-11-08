# Raid OS в App Store — всё для заполнения App Store Connect

Сборка: iPhone-приложение Raid OS (Capacitor), bundle id `com.tarkovoperator.app`, версия `0.6.0`, только iPhone
(`TARGETED_DEVICE_FAMILY=1` в `.github/workflows/ios-app-store.yml`), без оплаты и подписки внутри (`isIosApp()`,
`src/account/IosAccount.tsx`). Что уже сделано в коде для App Store — [05-ios-build-done.md](05-ios-build-done.md).
Сверено с правилами Apple и страницами App Store Connect на 09.11.2026.

Тексты в полях ниже даны как есть: их можно копировать в App Store Connect. Лимиты проверены
(`node scripts/app-store/check-fields.mjs`).

---

## 1. Что сделать руками (владелец)

| # | Что | Где |
| --- | --- | --- |
| 1 | Apple Developer Program, 99 $ в год. Продавец (Seller) будет виден в App Store. Организации нужен D-U-N-S | developer.apple.com/programs |
| 2 | Соглашение Free Apps (принимается при входе). Paid Apps, банк и налоги **не нужны**, пока приложение бесплатное и без покупок | App Store Connect → Business |
| 3 | Зарегистрировать Bundle ID `com.tarkovoperator.app` | Certificates, Identifiers & Profiles → Identifiers |
| 4 | Создать приложение: платформа iOS, имя `Raid OS`, основной язык «Русский», bundle id выше, SKU `RAIDOS-IOS` | App Store Connect → Apps → «+» |
| 5 | Цена: **Бесплатно**, все страны | Pricing and Availability |
| 6 | Ключ App Store Connect API и 4 секрета GitHub для автосборки в TestFlight (`APPLE_TEAM_ID`, `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_P8_BASE64`) | см. [05-ios-build-done.md](05-ios-build-done.md) |
| 7 | Тестовый аккаунт для Apple: отдельный e-mail, пароль, **«Доступ открыт»** на всё время проверки (иначе ревьюер увидит «Нет доступа»). Логин и пароль — только в App Store Connect, не в репозиторий | админ-панель → выдать доступ |
| 8 | Контакт для проверки: имя, телефон, e-mail | App Review Information |
| 9 | Ответить на вопрос о правах на чужой контент (раздел 6) | App Information → Content Rights |
| 10 | Copyright: `2026 <продавец, как в оферте>` | версия → General |

Перед отправкой на проверку — закрыть блокеры из раздела 7.

---

## 2. App Information (общие поля)

| Поле | Значение |
| --- | --- |
| Name (до 30) | `Raid OS` — одинаково на обоих языках. Если имя занято: `Raid OS: помощник рейдов` / `Raid OS: Raid Companion` |
| Основной язык | Русский; вторая локализация — English (U.S.) |
| Категория | Основная: **Справочники (Reference)**; дополнительная: **Утилиты (Utilities)** |
| Privacy Policy URL | `https://raidos.app/legal/privacy` |
| Support URL | `https://raidos.app/about` (там контакты поддержки) |
| Marketing URL | `https://raidos.app` |
| Возраст | **13+** (ответы в разделе 5) |
| Made for Kids | Нет |
| Шифрование (Export Compliance) | Только HTTPS системы: «не использует нестандартное шифрование». В `Info.plist` нужен `ITSAppUsesNonExemptEncryption = false` (см. блокер 7.1) — тогда вопрос не задаётся |
| Sign in with Apple | Не нужен: вход своим e-mail и паролем, без Google/Facebook (правило 4.8) |
| Реклама / IDFA | Нет |
| iPad | Скриншоты не нужны: сборка только для iPhone. iPad всё равно запустит её в режиме iPhone — ревьюер может проверять на iPad |

### Subtitle (до 30)

RU:
```text
Квесты, карты, цены и сборки
```
EN:
```text
Quests, maps, prices, builds
```

---

## 3. Страница версии

### Promotional Text (до 170, меняется без новой проверки)

RU:
```text
Всё для рейда в телефоне: план рейда, цели квестов с фото мест, карты, Оружейник, баллистика и путь к Каппе. PvP, PvE и Сезон — отдельно.
```
EN:
```text
Everything for your next raid on your phone: raid plan, quest objectives with photos, maps, Gunsmith, ballistics and Kappa. PvP, PvE and Season kept apart.
```

### Description (до 4000)

RU:
```text
Raid OS — помощник для рейдов в Escape from Tarkov: квесты, карты, цены, сборки и боссы в одном приложении.

ПЕРЕД РЕЙДОМ
• План рейда: какие ключи и предметы взять, какие квесты сделать на карте
• Кочевники: на какой карте их видели последний раз
• Действующие промокоды игры

КВЕСТЫ
• Текущие, сюжетные и выполненные задания всех торговцев
• Цели квестов с фото мест и предметами, которые нужно взять
• Ключи для квестов и задания для Каппы
• Отметка прогресса вручную; с Raid OS для Windows задания отмечаются сами

КАРТЫ
• Все локации: выходы, переходы, боссы, опасные зоны и точки ваших квестов
• Спутник и схема, этажи, карта на весь экран
• Рулетка, сетка снайпера и свои пометки

ОРУЖИЕ И ПАТРОНЫ
• Оружейник: каждая часть — сборка, характеристики и модули с ценами
• Сборка оружия по частям
• Баллистика: пробитие и урон всех патронов, падение пули, шанс пробить броню
• Тир-листы

ТОРГОВЛЯ И УБЕЖИЩЕ
• Цены барахолки и торговцев
• Что собрать для убежища и квестов
• Путь к Каппе: предметы «Коллекционера», отметка по фото схрона прямо на телефоне

БОССЫ
• 3D-модели, здоровье по частям тела, карты и тактика боя

ОТРЯД
• Друзья и отряд: общие квесты по картам

PvP, PvE и Сезон — у каждого режима свой прогресс. Несколько тем оформления.

Raid OS не вмешивается в игру: не читает её память, ничего не нажимает за вас и не обходит защиту.

Raid OS — неофициальное приложение и не связано с Battlestate Games. Escape from Tarkov — товарный знак Battlestate Games Limited.
```

EN:
```text
Raid OS is a raid companion for Escape from Tarkov: quests, maps, prices, builds and bosses in one app.

BEFORE THE RAID
• Raid plan: which keys and items to bring, which quests to do on the map
• Goons tracker: where they were last seen
• Current in-game promo codes

QUESTS
• Current, story and completed tasks of every trader
• Quest objectives with photos of the places and the items to bring
• Quest keys and Kappa tasks
• Mark progress by hand; with Raid OS for Windows quests tick themselves

MAPS
• Every location: extracts, transits, bosses, danger zones and your quest points
• Satellite and schematic views, floors, full-screen map
• Ruler, sniper grid and your own marks

WEAPONS AND AMMO
• Gunsmith: every part with its build, stats and mods with prices
• Weapon builder, part by part
• Ballistics: penetration and damage of every round, bullet drop, chance to penetrate armor
• Tier lists

TRADING AND HIDEOUT
• Flea market and trader prices
• What to collect for the hideout and quests
• Road to Kappa: Collector items, mark them from a photo of your stash right on the phone

BOSSES
• 3D models, health by body part, maps and combat tactics

SQUAD
• Friends and squad: shared quests by map

PvP, PvE and Season each keep their own progress. Several color themes.

Raid OS does not touch the game: it does not read its memory, press anything for you or bypass its protection.

Raid OS is an unofficial app and is not affiliated with Battlestate Games. Escape from Tarkov is a trademark of Battlestate Games Limited.
```

### Keywords (до 100, через запятую без пробелов)

Рекомендую без слова «Tarkov»: правило 2.3.7 запрещает набивать ключевые слова чужими торговыми марками (5.2.1).
Имя игры есть в описании с оговоркой о неофициальности — это допустимо.

RU:
```text
квесты,карты,барахолка,баллистика,оружейник,каппа,боссы,рейд,ключи,патроны,убежище,сборки,лут
```
EN:
```text
quests,maps,flea,ballistics,gunsmith,kappa,bosses,raid,keys,ammo,hideout,builds,loot,companion
```

Вариант с названием игры — ваш выбор, риск отказа по 2.3.7 / 5.2.1 выше:
```text
тарков,eft,квесты,карты,барахолка,баллистика,оружейник,каппа,боссы,ключи,патроны,убежище
```
```text
tarkov,eft,quests,maps,flea,ballistics,gunsmith,kappa,bosses,keys,ammo,hideout,builds
```

### What's New

У первой версии этого поля нет. Для следующего обновления (пример, только наши функции):

RU:
```text
Карта на весь экран, цели квестов с фото мест и исправления.
```
EN:
```text
Full-screen map, quest objectives with photos of the places, and fixes.
```

### Скриншоты

Готовые картинки — в [screenshots/](screenshots/): с подписью сверху (`<язык>/<размер>-<ориентация>/`) и чистые
экраны (`clean/…`). JPEG без прозрачности, точные размеры Apple. Загружать по порядку номеров `01…09`.

| Слот в App Store Connect | Папка | Размер | Обязателен |
| --- | --- | --- | --- |
| iPhone 6.3″ (Dynamic Island, medium) | `ru/6.3-portrait`, `en/6.3-portrait` | 1206 × 2622 | **да** |
| iPhone 6.9″ (Dynamic Island, large) | `ru/6.9-portrait`, `en/6.9-portrait` | 1320 × 2868 | нет, но лучше загрузить |
| iPhone 6.5″ (Face ID, large) | `ru/6.5-portrait`, `en/6.5-portrait` | 1242 × 2688 | нет, если есть 6.9″ |
| Горизонтальные (те же слоты) | `*/<размер>-landscape` | 2622 × 1206 и т. д. | нет |

Экраны: 01 план рейда · 02 цели квеста с фото места · 03 карта Таможни · 04 Оружейник · 05 карточка предмета с
ценами · 06 боссы в 3D · 07 баллистика · 08 путь к Каппе · 09 что собрать для квестов (только RU, см. 7.5).
Горизонтальные: план рейда, карта на весь экран, Оружейник, боссы, баллистика. Советую основной набор
вертикальный: в горизонтальном телефоне верхняя и нижняя панели забирают половину экрана.

Как сняты: настоящий интерфейс в режиме iPhone-сборки (`isIosApp()`, без цен подписки и оплаты), выдуманный профиль
«Оператор» PvP 28 уровня с настоящими квестами, без входа в аккаунт — на картинках нет e-mail и ников игроков.
Подложка Таможни — ваш собственный рендер (как в трейлере сайта); картинки карт tarkov.dev (CC BY-NC-SA,
некоммерческая лицензия) не использованы. Переснять: `scripts/app-store/README.md`.

---

## 4. App Privacy (раздел «Конфиденциальность приложения»)

Сверено с кодом iPhone-приложения и сервера. Отслеживание (tracking): **нет**. Сторонней аналитики и рекламы: **нет**.
Все данные ниже — **связаны с пользователем (Linked)**, **не для отслеживания**.

| Тип данных Apple | Что именно | Цель |
| --- | --- | --- |
| Contact Info → Email Address | e-mail аккаунта | App Functionality |
| Identifiers → User ID | id аккаунта, ник в игре | App Functionality |
| Identifiers → Device ID | случайный id установки приложения (лимит устройств аккаунта, защита) | App Functionality |
| User Content → Gameplay Content | прогресс квестов, отметки «Коллекционера», убежища, предметы, отряд и друзья | App Functionality |
| User Content → Photos or Videos | скриншоты, которые пользователь сам прикладывает к отчёту об ошибке или в чат поддержки | App Functionality |
| User Content → Customer Support | сообщения в чате поддержки | App Functionality |
| User Content → Other User Content | отчёты об ошибках и предложения, названия опубликованных сборок, отметки «Видел» у Кочевников, ответы на опросы | App Functionality |
| Usage Data → Product Interaction | «онлайн сейчас», какие объявления и опросы показаны и закрыты | App Functionality, Analytics |
| Diagnostics → Other Diagnostic Data | версия приложения и платформа в отчёте об ошибке | App Functionality |
| Other Data → Other Data Types | страна, указанная при регистрации | App Functionality, Analytics |

**Не собирается:** имя, телефон (вход по SMS выключен; если включите — добавить Contact Info → Phone Number),
местоположение устройства, контакты, покупки (в приложении их нет), финансовые данные, история браузера и поиска,
здоровье, данные о сбоях. **Фото схрона** для «Синхронизации по фото» распознаётся на телефоне и никуда не
отправляется — это не сбор.

Манифест `ios/App/App/PrivacyInfo.xcprivacy` должен совпадать с этой таблицей (см. блокер 7.1).

---

## 5. Возрастной рейтинг — ответы на анкету → 13+

| Вопрос | Ответ | Почему |
| --- | --- | --- |
| Parental Controls / Age Assurance | Нет / Нет | |
| Unrestricted Web Access | Нет | ссылки открываются в Safari, своего браузера нет |
| User-Generated Content | **Да** | названия сборок игроков и ники видны другим (см. 7.3) |
| Social Media | Нет | ленты нет |
| Messaging and Chat | Нет | чат только с поддержкой, не между игроками |
| Advertising | Нет | |
| Profanity or Crude Humor | Infrequent | тексты квестов из игры |
| Horror/Fear Themes | Infrequent | облик боссов и культистов |
| Alcohol, Tobacco, or Drug Use or References | Infrequent | игровые предметы (стимуляторы, алкоголь, сигареты) |
| Medical or Treatment Information / Health or Wellness | Нет / Нет | |
| Sexuality or Nudity (все три) | Нет | |
| Cartoon or Fantasy Violence | Нет | |
| Realistic Violence | Infrequent | цели «устранить», боссы с оружием |
| Prolonged Graphic or Sadistic Realistic Violence | Нет | |
| Guns or Other Weapons | **Frequent** | Оружейник, сборки, баллистика |
| Gambling / Simulated Gambling / Contests / Loot Boxes | Нет | |

Итог: **13+** (выставляют «Infrequent» алкоголь/реалистичное насилие и «Frequent» оружие).

---

## 6. App Review Information

- **Sign-in required:** да. Username / Password — тестовый аккаунт из пункта 1.7.
- **Contact:** имя, телефон, e-mail владельца.
- **Content Rights** («содержит ли приложение чужой контент»): **да** — названия, предметы, квесты, изображения и
  карты Escape from Tarkov. Отвечать «у меня есть права» — решение владельца (риск 7.6).
- **Notes** (по-английски, вставить как есть):

```text
Raid OS is an unofficial companion app for the PC game Escape from Tarkov (not affiliated with Battlestate Games). It never connects to the game, reads its memory or automates anything.

Sign in: on the first screen («Вход») enter the demo account above. The interface starts in Russian; switch to English: the last tab «Ещё» (More) → EN.

What to try:
- Overview: scroll to «Raid plan» — keys and items to bring for the map.
- Quests: tap a quest — objectives, photos of the places, items to bring.
- Maps: Customs with quest points, extracts and bosses; the corner button opens the map full screen.
- Gunsmith; More → Ballistics, Bosses (3D models, drag to rotate), Flea Market, Collector items.
- Collector items → the camera button: photograph the game's stash on a PC monitor; the photo is recognized on the device and is never uploaded (camera permission).

The app is free and contains no purchases, prices or links to purchases.
Accounts are created in the app with an e-mail and a password. Account deletion: Profile → Delete account (confirmed with the password).
The optional Raid OS app for Windows can send quest progress to the same account; it is not needed to use the iPhone app.
The local network permission text is used only when the app is pointed to a developer's test server in the same Wi-Fi; regular users are never asked.
```

Длина заметок — в пределах 4000 знаков.

---

## 7. Блокеры и риски перед отправкой

**7.1 Блокер — нативный проект iOS.** В выпуске 0.6.0.78 настройки App Store из `ios/` откатились (публикатор не
принимает `ios/` в `release/production`). Сейчас в `ios/App/App/Info.plist` нет текста доступа к камере
(`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`) — кнопка «Синхронизация по фото» с
`capture="environment"` на iPhone **закроет приложение**; нет `ITSAppUsesNonExemptEncryption`; нет
`PrivacyInfo.xcprivacy`; проект собирается и для iPad. Проверка в `ios-app-store.yml` (`PrivacyInfo`, флаг
шифрования) на такой сборке упадёт. Нужно: вернуть эти файлы из `632aea9` в отдельную нативную ветку (как Android:
`RAIDOS_ANDROID_REF`) и научить `ios-app-store.yml` брать `ios/` оттуда; манифест обновить по таблице раздела 4
(в старом нет Device ID, Customer Support, Photos, Product Interaction, страны; телефон лишний).

**7.2 Главный риск — правило 3.1.1.** Доступ к данным в iPhone-приложении открывается подпиской, купленной на сайте,
а встроенной покупки (In-App Purchase) нет. Исключения 3.1.3(a) «читалки» (журналы, книги, музыка, видео) и 3.1.3(f)
(VoIP, облако, почта, хостинг) к Raid OS не подходят; 3.1.3(b) разрешает доступ к купленному на других платформах,
только если то же продаётся и через In-App Purchase. Отсутствие кнопок оплаты не снимает риск. Варианты:
а) добавить подписку через In-App Purchase на iPhone (комиссия Apple 15–30 %; нужны Paid Apps, банк, налоги);
б) открыть iPhone-версию всем аккаунтам бесплатно;
в) отправить как есть и ответить ревьюеру — высокий шанс отказа по 3.1.1.

**Оплата и в Apple, и на сайте — можно** (правило 3.1.3(b), проверено 09.11.2026):
- Подписка с сайта работает в iPhone-приложении, если ту же подписку можно купить и внутри приложения через Apple.
  Цену в Apple можно поставить свою, например выше — чтобы покрыть комиссию.
- **Комиссия Apple:** 30 %; **15 %** в App Store Small Business Program (доход до 1 млн $ в год, нужно подать заявку);
  у подписок без этой программы — 15 % со второго года подписчика.
- Звать на сайт из приложения («дешевле на сайте», кнопка, ссылка) — только на витрине США: там сейчас можно и без
  комиссии, но это временно, пока идёт суд Apple и Epic. В остальных странах — нельзя.
- **Россия:** с 1 апреля 2026 Apple не принимает оплату в App Store (только остаток на балансе Apple Account) —
  российские игроки и дальше платят на сайте, а в приложении просто входят в аккаунт.
- Для покупок в Apple нужны: соглашение Paid Apps, банк и налоговые формы, кнопка «Восстановить покупки», условия
  подписки и ссылки на условия и политику в приложении (3.1.2), проверка покупки на нашем сервере, чтобы доступ
  открывался на аккаунте Raid OS и на ПК, и на сайте.

Источники: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Small Business Program](https://developer.apple.com/app-store/small-business-program/),
[9to5Mac, 13.08.2026](https://9to5mac.com/2026/08/13/apple-proposes-commissions-of-up-to-15-for-off-app-store-purchases-in-the-us/),
[Apple: оплата в России](https://support.apple.com/en-ae/126891).

**7.3 Правило 1.2 (контент пользователей).** Названия сборок игроков («Сборка оружия», `/v1/builds`) и ники видят
другие игроки, а кнопки «Пожаловаться» на сборку нет. Apple требует: фильтр, «Пожаловаться», «Заблокировать» и
контакты. Блокировка друзей уже есть; нужно «Пожаловаться» у сборки (или скрыть публикацию сборок на iPhone).

**7.4 Язык для ревьюера.** Приложение всегда стартует на русском (`LocaleProvider`), даже на английском iPhone.
Ревьюер переключит по заметке, но лучше стартовать на английском, если язык телефона не русский.

**7.5 Пробелы английского перевода** (найдено при съёмке): подзаголовки «Баллистика» и «Предметы для
«Коллекционера»», кнопка «Синхронизация по фото» и страница «Что собрать для убежища» частично на русском;
английская страница «Что собрать для квестов» (`/hideout/quests`) открывается **пустой** (на русском работает, ошибок в
консоли нет). На скриншотах обойдено прокруткой, экран 09 есть только на русском.

**7.6 Чужой контент (5.2.1 / 5.2.2).** Картинки предметов, модели боссов и данные игры принадлежат Battlestate Games;
карты tarkov.dev — CC BY-NC-SA (некоммерческая лицензия). В описании есть оговорка о неофициальности. Apple вправе
запросить разрешение правообладателя; при жалобе приложение снимут.

**7.7 Политика конфиденциальности** на сайте только на русском. Для английской витрины желательна английская версия.

**7.8 Объявления владельца** приходят и в iPhone-приложение. Пока идёт проверка — без цен, скидок и ссылок на оплату
(иначе 3.1.1).

---

## 8. Порядок отправки

1. Закрыть 7.1 (и решить 7.2), выпустить версию с нативными настройками.
2. Пункты 1.1–1.6 → сборка приходит в TestFlight сама (`ios-app-store.yml`).
3. Проверить сборку в TestFlight на своём iPhone: вход, «Синхронизация по фото», удаление аккаунта, EN.
4. Заполнить разделы 2–6, загрузить скриншоты, выбрать сборку, «Add for Review» → «Submit».
