import { featureEnabled, type ArchivedFeature } from '../app/archivedFeatures'

/**
 * The sections of the left menu as cards of the Overview's top row (owner, 11.11.2026: «туда можно было добавить любой блок из
 * меню слева. То есть отряд, ключи для квестов, барахолка, торговля… торговцы, убежище и квесты»). The same sections, order and
 * switches as the sidebar (src/app/AppShell.tsx — a section added there is added here too); «Обзор» itself is not one.
 * Each card opens its page (overview/MenuBlockCard.tsx). On the PC only; the phone has its own blocks.
 */
export interface MenuBlock {
  id: string
  to: string
  label: string
  /** One short line under the name (owner: no long texts in the interface). */
  hint: string
  feature?: ArchivedFeature
}

const ALL: readonly MenuBlock[] = [
  { id: 'nav-quests', to: '/quests', label: 'Квесты', hint: 'Задания и цепочки' },
  { id: 'nav-maps', to: '/maps', label: 'Карты', hint: 'Точки квестов, выходы, лут' },
  { id: 'nav-bosses', to: '/gallery', label: 'Боссы', hint: 'Где и как часто' },
  { id: 'nav-briefing', to: '/briefing', label: 'Брифинг рейда', hint: 'Что взять в рейд', feature: 'raidBriefing' },
  { id: 'nav-keep-items', to: '/keep-items', label: 'Что не продавать', hint: 'Нужно для квестов и убежища', feature: 'keepItems' },
  { id: 'nav-kappa-items', to: '/kappa-items', label: 'Предметы для Каппы', hint: 'Коллекционер', feature: 'kappaMenu' },
  { id: 'nav-squad', to: '/squad', label: 'Отряд', hint: 'Рейд вместе с друзьями' },
  { id: 'nav-flea', to: '/flea', label: 'Барахолка', hint: 'Цены и избранное' },
  { id: 'nav-quest-keys', to: '/quest-keys', label: 'Ключи для квестов', hint: 'Какие ключи нужны' },
  { id: 'nav-trading', to: '/economy/trading', label: 'Торговля', hint: 'Выгодные сделки' },
  { id: 'nav-tier-lists', to: '/tier-lists', label: 'Тир листы', hint: 'Лучшее снаряжение' },
  { id: 'nav-traders', to: '/traders', label: 'Торговцы', hint: 'Уровни и товары' },
  { id: 'nav-hideout', to: '/hideout', label: 'Убежище и квесты', hint: 'Что найти для убежища' },
  { id: 'nav-value', to: '/economy', label: 'Рейтинг ценности', hint: 'Что дороже за клетку', feature: 'economyTools' },
  { id: 'nav-barters', to: '/economy/barters', label: 'Бартеры', hint: 'Выгодные обмены', feature: 'economyTools' },
  { id: 'nav-crafts', to: '/economy/crafts', label: 'Крафты', hint: 'Выгодные крафты', feature: 'economyTools' },
  { id: 'nav-ballistics', to: '/ballistics', label: 'Баллистика', hint: 'Патроны и броня' },
]

/** Every menu card that may stand on the Overview (switched-off sections left out), in the sidebar's order. */
export const MENU_BLOCKS: readonly MenuBlock[] = ALL.filter((block) => !block.feature || featureEnabled(block.feature))

/** Every id a saved layout may carry, switched-off sections included (they are dropped when drawn, not when read). */
export const MENU_BLOCK_IDS: readonly string[] = ALL.map((block) => block.id)

export const menuBlock = (id: string) => MENU_BLOCKS.find((block) => block.id === id)
