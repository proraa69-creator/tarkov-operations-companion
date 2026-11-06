import type { GuideTipContent } from './FirstRunGuide'

/**
 * Tips about the app's functions (owner, 03.11.2026: «человека с ходу при входе не должно осыпать окнами, ему нужно дать
 * выбор, показать или нет, если да, то каждое окно по очереди, но только когда он на конкретной вкладке… это только 1 раз
 * при первом входе… а если после обновления выходит новая функция, она показывается всем пользователям 1 раз… если вышли
 * новые функции, а человек еще не заходил ни разу, они не должны появлятся поверх других окон… показывай только основную
 * информацию»):
 *  - a new player is asked once, «Показать возможности Raid OS?»; with «Показать» each section's few short tips come on
 *    its first visit, one after another; with «Нет» none ever;
 *  - news (`NEWS`): only the latest release's, each once, in its own section; a player who started with that release or
 *    later gets none (their section's tips already say it), nor older ones.
 * Kept on this device; nothing goes to the server.
 */
export const TOURS_KEY = 'raidos-feature-tours-v1'
export const TOURS_CHANGED_EVENT = 'raidos-feature-tours-changed'

export interface ToursRecord {
  /** ask: the question is still due; yes / no: the player's answer (an existing player starts with `no`). */
  choice: 'ask' | 'yes' | 'no'
  /** The newest release with news when this device started with the tips: news of that release or older never show. */
  since: string
  /** Tips shown: `<section>:<step>` and `news:<id>`. */
  seen: string[]
}

export interface TourContext { phone: boolean; desktop: boolean; inRaid?: boolean }
export interface TourStep { id: string; tip: GuideTipContent; when?: (context: TourContext) => boolean }
export interface TourSection { id: string; matches: (pathname: string) => boolean; steps: TourStep[] }
export interface NewsItem {
  id: string
  release: string
  matches: (pathname: string) => boolean
  tip: GuideTipContent
  when?: (context: TourContext) => boolean
  /** Being on this page counts as seen. */
  doneOn?: string
  /** Already shown some other way on this device. */
  seenBefore?: () => boolean
}

const pc = ({ desktop, phone }: TourContext) => desktop && !phone
const same = (path: string) => (pathname: string) => pathname === path
const under = (path: string) => (pathname: string) => pathname === path || pathname.startsWith(`${path}/`)
const storedFlag = (key: string) => {
  try { return localStorage.getItem(key) !== null } catch { return false }
}

const TRADING_PATH = '/economy/trading'
/** Set by the window 0.6.0.246 showed for «Торговля» on its own: who closed it has been told. */
const TRADING_WINDOW_0_6_0_246 = 'raidos-trading-intro-v1'

export const SECTIONS: TourSection[] = [
  { id: 'overview', matches: same('/'), steps: [
    // The PC app reads the game; the phone and browser builds get the quests from it through the account.
    { id: 'tasks', when: pc, tip: {
      title: { ru: 'Текущие задания', en: 'Current tasks' },
      text: () => ({ ru: 'Квесты выбранной карты: Raid OS берёт их из журналов игры. Если каких-то нет, нажмите на странице «Квесты» «Найти квесты по экрану» и откройте в игре «Персонаж» → «Задания».', en: 'The chosen map’s quests: Raid OS reads them from the game’s logs. If some are missing, press Find quests on screen on the Quests page and open Character → Tasks in the game.' }),
      target: '[data-block="tasks"]',
    } },
    { id: 'tasks', when: (context) => !pc(context), tip: {
      title: { ru: 'Текущие задания', en: 'Current tasks' },
      text: () => ({ ru: 'Квесты выбранной карты. Они приходят с ПК, где вы играете: установите там Raid OS и войдите в тот же аккаунт.', en: 'The chosen map’s quests. They come from the PC you play on: install Raid OS there and sign in to the same account.' }),
      target: '[data-block="tasks"]',
    } },
    { id: 'raid-needs', tip: {
      title: { ru: 'Требования рейда', en: 'Raid requirements' },
      text: () => ({ ru: 'Что взять с собой на эту карту, чтобы сделать квесты.', en: 'What to take to this map to do its quests.' }),
      target: '.raid-needs',
    } },
    { id: 'loadout', tip: {
      title: { ru: 'Сбор на рейд', en: 'Raid loadout' },
      text: () => ({ ru: 'С каким оружием и снаряжением выполнять квест.', en: 'Which weapon and gear a quest needs.' }),
      target: '.quest-conditions-card',
    } },
  ] },
  { id: 'quests', matches: same('/quests'), steps: [
    { id: 'story', when: pc, tip: {
      title: { ru: 'Сюжетные задания', en: 'Story quests' },
      text: () => ({ ru: 'Откройте в игре окно сюжетного задания на 3 секунды — Raid OS сам прочитает его этапы.', en: 'Open a story quest’s window in the game for 3 seconds: Raid OS reads its stages by itself.' }),
      target: '[data-guide="story-tab"]',
    } },
  ] },
  { id: 'maps', matches: under('/maps'), steps: [
    { id: 'checkmark', tip: {
      title: { ru: 'Галочка у задания', en: 'The checkmark by a quest' },
      text: () => ({ ru: 'Сделали задание в рейде — нажмите галочку, и его точки уйдут с карты. В игре задание от этого не выполняется.', en: 'Done a quest in the raid? Press its checkmark and its points leave the map. It does not complete the quest in the game.' }),
      target: '.quest-raid-check',
      media: 'checkmark',
      press: true,
    } },
    { id: 'view', tip: {
      title: { ru: 'Схема и спутник', en: 'Scheme and satellite' },
      text: () => ({ ru: 'Здесь переключается вид карты.', en: 'The map’s view switches here.' }),
      target: '.map-view-trigger',
    } },
    { id: 'position', when: pc, tip: {
      title: { ru: 'Ваша точка на карте', en: 'Your position on the map' },
      text: () => ({ ru: 'Назначьте в игре клавишу скриншота («Настройки» → «Управление»): по скриншоту Raid OS покажет, где вы.', en: 'Set the screenshot key in the game (Settings → Controls): Raid OS shows where you are from the screenshot.' }),
    } },
  ] },
  { id: 'kappa', matches: same('/kappa-items'), steps: [
    { id: 'collect', tip: {
      title: { ru: 'Предметы для «Коллекционера»', en: 'Items for “Collector”' },
      text: (phone) => (phone
        ? { ru: 'Отмечайте собранные предметы нажатием. Сканировать их можно в приложении для ПК.', en: 'Tick the items you have collected. The PC app can scan them.' }
        : { ru: 'Сложите находки в один контейнер, откройте его в игре и нажмите «Сканировать». Или отметьте вручную.', en: 'Put your finds into one container, open it in the game and press “Scan”. Or tick them by hand.' }),
      media: 'kappa',
    } },
  ] },
  { id: 'hideout', matches: same('/hideout'), steps: [
    { id: 'hub', tip: {
      title: { ru: 'Убежище и квесты', en: 'Hideout & quests' },
      text: () => ({ ru: 'Что собрать для убежища и квестов, и какие предметы из схрона больше не нужны.', en: 'What to collect for the hideout and quests, and which stash items are no longer needed.' }),
      target: '.hideout-hub-choices',
    } },
  ] },
  { id: 'tier-lists', matches: same('/tier-lists'), steps: [
    { id: 'tiers', tip: {
      title: { ru: 'Тир листы', en: 'Tier lists' },
      text: () => ({ ru: 'Предметы по тирам S–D: по цене за слот в выбранном режиме или по характеристикам.', en: 'Items in tiers S–D: by price per slot in the chosen mode or by their stats.' }),
    } },
  ] },
  { id: 'screen', matches: same('/screen'), steps: [
    { id: 'about', when: pc, tip: {
      title: { ru: 'Настройка экрана', en: 'Screen settings' },
      text: () => ({ ru: 'Делает тёмные места в игре светлее. Меняется только настройка монитора, игра не затрагивается.', en: 'Makes the game’s dark places brighter. Only the monitor’s setting changes, not the game.' }),
    } },
    { id: 'keys', when: pc, tip: {
      title: { ru: 'Клавиши', en: 'Keys' },
      text: () => ({ ru: 'Одна клавиша включает пресет прямо в игре, другая переключает пресеты.', en: 'One key turns a preset on in the game, another switches presets.' }),
      target: '.preset-keys',
    } },
  ] },
]

/**
 * The latest release's news. A newer release with news replaces these: only the entries of the newest `release` here
 * ever show. Short, the main thing only (owner: «не нужно расписывать… слишком много информации, сделай короче»).
 */
/** The release in which the page first got its statistics in the desktop app, with its new tab. */
const TRADING_RELEASE = '0.6.0.256'

export const NEWS: NewsItem[] = [
  // Owner, 05.11.2026: «уведомление о новой функции торговли должно быть посередине, как у нас все всплывающие окна с указателем».
  { id: 'trading', release: TRADING_RELEASE, matches: (pathname) => pathname !== TRADING_PATH, doneOn: TRADING_PATH, seenBefore: () => storedFlag(TRADING_WINDOW_0_6_0_246), tip: {
    title: { ru: 'Новое: Торговля', en: 'New: Trading' },
    text: () => ({ ru: 'Минимум, максимум и цена сейчас: что купить дешевле и продать дороже. «Продажа модулей»: детали для Оружейника дешевле у торговца, дороже на барахолке.', en: 'Low, high and the price now: what to buy low and sell high. «Module sales»: Gunsmith parts, cheaper at a trader, dearer on the flea market.' }),
    note: { ru: 'Не гарантия заработка, а статистика. Из-за скачков цена может отличаться.', en: 'No guarantee of earnings, only statistics. Price jumps can make the price differ.' },
    target: `.nav-link[href$="${TRADING_PATH}"]`,
    centred: true,
    opens: TRADING_PATH,
  } },
  // Owner, 05.11.2026: «справа еще кнопку добавь… кнопку продажа торговцам».
  { id: 'trader-sales', release: TRADING_RELEASE, matches: same(TRADING_PATH), tip: {
    title: { ru: 'Новое: Продажа торговцам', en: 'New: Selling to traders' },
    text: () => ({ ru: 'На барахолке дешевле, чем платит торговец: купил и сразу продал. Сначала самые выгодные.', en: 'Cheaper on the flea market than a trader pays: buy and sell at once. The most profitable first.' }),
    target: '.trading-view-traders',
  } },
  { id: 'deferred-quests', release: '0.6.0.218', matches: under('/maps'), when: pc, tip: {
    title: { ru: 'Новое: отложенные квесты', en: 'New: deferred quests' },
    text: () => ({ ru: 'Нет ключа или предмета? Отложите квест — он не будет мешать в списке и вернётся сам.', en: 'No key or item yet? Put the quest aside: it stays out of the list and comes back by itself.' }),
    target: '.deferred-quests-button',
  } },
]

/** Earlier «Новое» pointers kept as shown on this device (src/onboarding/NewFeaturesTip.tsx before 0.6.0.219). */
const OLD_NEWS_KEYS = ['raidos-new-features-v2', 'raidos-new-features-0-6-0-196-v1']

/** «0.6.0.218» < «0.6.0.219»: by number, part by part. */
export function compareReleases(a: string, b: string) {
  const left = a.split(/[.-]/).map(Number), right = b.split(/[.-]/).map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] || 0) - (right[index] || 0)
    if (difference) return Math.sign(difference)
  }
  return 0
}

export const LATEST_NEWS_RELEASE = NEWS.reduce((latest, item) => (compareReleases(item.release, latest) > 0 ? item.release : latest), '0')

export function readTours(): ToursRecord | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOURS_KEY) ?? 'null') as Partial<ToursRecord> | null
    if (!parsed || !['ask', 'yes', 'no'].includes(String(parsed.choice))) return null
    return { choice: parsed.choice as ToursRecord['choice'], since: typeof parsed.since === 'string' ? parsed.since : '0', seen: Array.isArray(parsed.seen) ? parsed.seen.filter((key): key is string => typeof key === 'string') : [] }
  } catch {
    return null
  }
}

export function writeTours(record: ToursRecord) {
  try { localStorage.setItem(TOURS_KEY, JSON.stringify(record)) } catch { /* storage unavailable: asked again next start */ }
  window.dispatchEvent(new Event(TOURS_CHANGED_EVENT))
}

/**
 * The record of this device, made on the first look: a new player is asked (and gets no news of this release, the
 * sections say it); an existing one is not asked and gets the latest news once, minus the pointers it already saw.
 */
export function startTours(newPlayer: boolean): ToursRecord {
  const existing = readTours()
  if (existing) return existing
  const seen: string[] = []
  try {
    for (const key of OLD_NEWS_KEYS) {
      const stored: unknown = key === 'raidos-new-features-v2' ? JSON.parse(localStorage.getItem(key) ?? '[]') : localStorage.getItem(key) !== null ? ['deferred-quests'] : []
      if (Array.isArray(stored)) for (const id of stored) if (typeof id === 'string') seen.push(`news:${id}`)
    }
  } catch { /* nothing seen before */ }
  const record: ToursRecord = newPlayer ? { choice: 'ask', since: LATEST_NEWS_RELEASE, seen: [] } : { choice: 'no', since: '0', seen }
  writeTours(record)
  return record
}

export interface DueTip { key: string; tip: GuideTipContent; news: boolean }

/** The tips due on this page now, in turn: the section's (after «Показать») then the latest news not seen yet. */
export function dueTips(pathname: string, record: ToursRecord, context: TourContext): DueTip[] {
  const due: DueTip[] = []
  if (record.choice === 'yes') {
    for (const section of SECTIONS) {
      if (!section.matches(pathname)) continue
      for (const step of section.steps) {
        const key = `${section.id}:${step.id}`
        if ((step.when?.(context) ?? true) && !record.seen.includes(key)) due.push({ key, tip: step.tip, news: false })
      }
    }
  }
  // Never over a raid: it is still due after it.
  if (record.choice !== 'ask' && !context.inRaid) {
    for (const item of NEWS) {
      const key = `news:${item.id}`
      if (item.release !== LATEST_NEWS_RELEASE || compareReleases(item.release, record.since) <= 0 || item.seenBefore?.()) continue
      if (item.matches(pathname) && (item.when?.(context) ?? true) && !record.seen.includes(key)) due.push({ key, tip: item.tip, news: true })
    }
  }
  return due
}

export function markTipSeen(key: string) {
  const record = readTours()
  if (!record || record.seen.includes(key)) return
  writeTours({ ...record, seen: [...record.seen, key] })
}

/** The player reached the page by themselves: its news has nothing left to tell. */
export function markNewsDone(pathname: string) {
  for (const item of NEWS) if (item.doneOn === pathname) markTipSeen(`news:${item.id}`)
}

export function answerTours(choice: 'yes' | 'no') {
  const record = readTours()
  if (record) writeTours({ ...record, choice })
}

/** Settings → «Показать снова»: every section's tips once more on the next visits. */
export function replayTours() {
  const record = readTours() ?? { choice: 'yes' as const, since: LATEST_NEWS_RELEASE, seen: [] }
  writeTours({ ...record, choice: 'yes', seen: record.seen.filter((key) => key.startsWith('news:')) })
}
