import { MAP_PLACE_SIGNS } from './mapPlaceSigns'

/**
 * Развязка's shop signs on «2 этаж» and «3 этаж» (src/components/ShopSigns.tsx; owner, 03.11.2026: «у каждого магазина в
 * виде сверху должно быть написано название. В стиле этого магазина… процентов на 30 надпись по этой площади
 * посередине», then «скорректируй размер логотипа магазина сам, что бы было комфортно видно и не криво» and «рамки у
 * всех должны быть закругленные как у ADIK»). Where: tarkov.dev's labels of the map (the shop's name, floor and point);
 * each plate sits in the middle of the shop's room as the scheme's walls bound it (IDEA's partitioned hall and two shops
 * of the west facade set by hand; kiosks the walls do not close get their plate on their point). Size: IDEA, OLI and
 * Гошан about 30 % of their hall; every other shop of a floor letters of one height, smaller only where the room is
 * too small, and plates never overlap. The look: the in-game signs' colours and lettering, as found on the web (fan
 * wikis, screenshots), no logos; every plate has the same rounded corners.
 * x, z: the plate's centre in game metres; w, h: the room for it in metres (along x and z; the plate keeps the text's own
 * proportions inside); vertical: a narrow, tall room's plate runs along it, its letters reading from bottom to top; sign:
 * the text as the sign shows it (its case included; a line break: two lines); floor: the scheme group of the floor.
 */
export type ShopSignFont = 'geometric-bold' | 'condensed-bold' | 'serif' | 'script' | 'slab' | 'rounded' | 'stencil' | 'thin-sans' | 'plain'

export interface ShopSign {
  name: string
  /** The floor's scheme group, or its name where the map has no scheme. */
  floor: string
  sign: string
  /** The text in English, where a place's name is not what a sign shows. */
  signEn?: string
  x: number
  z: number
  w: number
  h: number
  vertical?: boolean
  bg: string
  fg: string
  font: ShopSignFont
  italic?: boolean
  accent?: 'stripe' | 'cross'
  accentColor?: string
}

/** Windows' own fonts first (the desktop app), then what a phone has. */
export const SHOP_SIGN_FONTS: Record<ShopSignFont, { family: string; weight: number }> = {
  'geometric-bold': { family: '"Arial Black", "Segoe UI Black", Arial, sans-serif', weight: 900 },
  'condensed-bold': { family: 'Impact, "Arial Narrow", "Roboto Condensed", sans-serif', weight: 700 },
  serif: { family: 'Georgia, "Times New Roman", serif', weight: 700 },
  script: { family: '"Segoe Script", "Brush Script MT", cursive', weight: 700 },
  slab: { family: 'Rockwell, "Courier New", serif', weight: 700 },
  rounded: { family: '"Arial Rounded MT Bold", "Segoe UI", sans-serif', weight: 700 },
  stencil: { family: 'Stencil, Impact, sans-serif', weight: 700 },
  'thin-sans': { family: '"Segoe UI Light", "Helvetica Neue", Arial, sans-serif', weight: 300 },
  plain: { family: '"Segoe UI", Roboto, Arial, sans-serif', weight: 600 },
}

/** The sign's lines of text: one, or two for a long name in a short room. */
export function signLines(sign: Pick<ShopSign, 'sign'>) {
  return sign.sign.split('\n')
}

/** The plate's thickness in letter heights: 1 for one line, 1.8 for two. */
export function signThickness(sign: Pick<ShopSign, 'sign'>) {
  return signLines(sign).length > 1 ? 1.8 : 1
}

/** The signs of one floor of a map (src/data/mapPlaceSigns.ts; Развязка's shops here), by the floor's scheme group or name. */
export function shopSignsOf(mapId: string, floor: string | undefined): ShopSign[] {
  if (!floor) return []
  return [...(mapId === 'interchange' ? INTERCHANGE_SHOP_SIGNS : []), ...(MAP_PLACE_SIGNS[mapId] ?? [])].filter((sign) => sign.floor === floor)
}

export const INTERCHANGE_SHOP_SIGNS: ShopSign[] = [
  { name: 'IDEA', floor: 'First_Floor', sign: 'IDEA', x: -34.2, z: -240.4, w: 87.1, h: 29.3, bg: '#0a5baa', fg: '#ffd21a', font: 'geometric-bold', accent: 'stripe', accentColor: '#ffd21a' },
  { name: 'Goshan', floor: 'First_Floor', sign: 'Гошан', x: -114.6, z: -55.7, w: 50.9, h: 17.8, bg: '#e8e2d8', fg: '#e2462c', font: 'rounded' },
  { name: 'OLI', floor: 'First_Floor', sign: 'OLI', x: -12.4, z: 138.2, w: 86.3, h: 36.7, bg: '#2db34a', fg: '#ffffff', font: 'geometric-bold' },
  { name: 'Nortex', floor: 'First_Floor', sign: 'NORTEX', x: 94.2, z: -148.9, w: 3.8, h: 11.4, vertical: true, bg: '#1b1b1b', fg: '#ffffff', font: 'condensed-bold', accent: 'stripe', accentColor: '#d0102a' },
  { name: 'TRend', floor: 'First_Floor', sign: 'tRend', x: 63.2, z: -156.2, w: 9.2, h: 3.8, bg: '#1a1418', fg: '#c23be6', font: 'condensed-bold' },
  { name: 'Mode7', floor: 'First_Floor', sign: 'MODE7', x: 71.2, z: -138.3, w: 3.8, h: 11, vertical: true, bg: '#ffffff', fg: '#111111', font: 'thin-sans' },
  { name: 'TTS', floor: 'First_Floor', sign: 'TTS', x: 19.6, z: -135, w: 9.1, h: 3.8, bg: '#1e3f8f', fg: '#ffffff', font: 'geometric-bold' },
  { name: 'Book Store', floor: 'First_Floor', sign: 'КНИГОеД', x: -31.2, z: -129.1, w: 18.2, h: 3.8, bg: '#141414', fg: '#f4f4f4', font: 'geometric-bold', accent: 'stripe', accentColor: '#f07a1e' },
  { name: 'Dino Clothes', floor: 'First_Floor', sign: 'DINO\nCLOTHES', x: 94.4, z: -112, w: 5.4, h: 13.6, vertical: true, bg: '#3e6b34', fg: '#f2f2f2', font: 'rounded' },
  { name: 'EMERCOM', floor: 'First_Floor', sign: 'EMERCOM', x: 22.1, z: -105.8, w: 18.6, h: 3.8, bg: '#1d4f9c', fg: '#ffffff', font: 'geometric-bold', accent: 'stripe', accentColor: '#f39200' },
  { name: 'Kostin', floor: 'First_Floor', sign: 'KOSTIN', x: -27.4, z: -105.3, w: 12.7, h: 3.8, bg: '#3a3b3a', fg: '#a8a8a8', font: 'thin-sans' },
  { name: 'Bizarro', floor: 'First_Floor', sign: 'Bizarro', x: -61.2, z: -102.9, w: 14.8, h: 3.8, bg: '#2b0f3a', fg: '#f9d423', font: 'script' },
  { name: 'Spiel', floor: 'First_Floor', sign: 'Spiel', x: 94.4, z: -84.6, w: 3.8, h: 11, vertical: true, bg: '#f4c430', fg: '#d62828', font: 'rounded' },
  { name: 'Voyage', floor: 'First_Floor', sign: 'VOYAGE', x: -18, z: -87, w: 15.5, h: 3.8, bg: '#12324f', fg: '#e9dcc0', font: 'serif' },
  { name: 'Viking', floor: 'First_Floor', sign: 'VIKING', x: 56.1, z: -73.3, w: 15.5, h: 3.8, bg: '#263238', fg: '#eceff1', font: 'slab', accent: 'stripe', accentColor: '#f07a1e' },
  { name: 'Mantis', floor: 'First_Floor', sign: 'MANTIS', x: 17.9, z: -73.3, w: 12.7, h: 3.8, bg: '#1a2229', fg: '#ffffff', font: 'thin-sans' },
  { name: 'German', floor: 'First_Floor', sign: 'GERMAN', x: -18, z: -72, w: 11.4, h: 3.8, bg: '#222222', fg: '#eeeeee', font: 'condensed-bold' },
  { name: 'The National', floor: 'First_Floor', sign: 'THE NATIONAL', x: 55.7, z: -36.4, w: 27.9, h: 3.8, bg: '#0e2440', fg: '#c9a85c', font: 'serif' },
  { name: 'Brutal', floor: 'First_Floor', sign: 'BRUTAL', x: 17.8, z: -36.4, w: 15.7, h: 3.8, bg: '#0d0d0d', fg: '#f2f2f2', font: 'stencil' },
  { name: 'Kiba', floor: 'First_Floor', sign: 'KIBA', x: -16.2, z: -29.1, w: 8.2, h: 3.8, bg: '#e6e6e3', fg: '#111111', font: 'condensed-bold' },
  { name: 'Pretty Lights', floor: 'First_Floor', sign: 'Pretty\nLights', x: -30.8, z: -29.1, w: 6.9, h: 13, vertical: true, bg: '#1a1033', fg: '#ffd36e', font: 'script' },
  { name: 'Telespot', floor: 'First_Floor', sign: 'telespot', x: 94.4, z: -23, w: 3.8, h: 17.6, vertical: true, bg: '#e30613', fg: '#ffffff', font: 'geometric-bold' },
  { name: 'Revis', floor: 'First_Floor', sign: 'Revi\'s', x: 63.5, z: -16.7, w: 14.5, h: 3.8, bg: '#c41230', fg: '#ffffff', font: 'geometric-bold' },
  { name: 'ADIK', floor: 'First_Floor', sign: 'adik', x: 22.6, z: -11.1, w: 9.8, h: 3.8, bg: '#ffffff', fg: '#111111', font: 'geometric-bold' },
  { name: 'Generic', floor: 'First_Floor', sign: 'GENERIC', x: -27.5, z: -5, w: 14.6, h: 3.8, bg: '#f2f2f2', fg: '#1a1a1a', font: 'thin-sans' },
  { name: 'Top Brand', floor: 'First_Floor', sign: 'TOP BRAND', x: 94.4, z: 16.5, w: 3.6, h: 20.1, vertical: true, bg: '#ececec', fg: '#8e1b1b', font: 'serif', accent: 'stripe', accentColor: '#8e1b1b' },
  { name: 'Sports', floor: 'First_Floor', sign: 'SPORTS', x: 63.4, z: 10.1, w: 11.4, h: 3.8, bg: '#1c5db8', fg: '#ffffff', font: 'condensed-bold', italic: true },
  { name: 'Yushka', floor: 'First_Floor', sign: 'Yushka', x: 70.7, z: 27.7, w: 3.8, h: 12.8, vertical: true, bg: '#f7ebd0', fg: '#b5382b', font: 'rounded' },
  { name: 'Rasmussen', floor: 'First_Floor', sign: 'RASMUSSEN', x: 20.2, z: 24.4, w: 22.3, h: 3.8, bg: '#ffffff', fg: '#1f2f3f', font: 'serif' },
  { name: 'Avokado', floor: 'First_Floor', sign: 'AVOKADO', x: -33.7, z: 24.9, w: 18.6, h: 3.8, bg: '#2a2a2a', fg: '#e6e6e6', font: 'geometric-bold' },
  { name: 'Boots 4 Life', floor: 'First_Floor', sign: 'BOOTS 4 LIFE', x: 94.4, z: 49.5, w: 3.8, h: 26.8, vertical: true, bg: '#4e3524', fg: '#f1e2c4', font: 'slab' },
  { name: 'Texho', floor: 'First_Floor', sign: 'TEXHO', x: 63.4, z: 46.1, w: 13.8, h: 3.8, bg: '#1a1a1a', fg: '#00a0e3', font: 'geometric-bold' },
  { name: 'Dom', floor: 'First_Floor', sign: 'DOM', x: 9.3, z: 45.3, w: 8.5, h: 3.8, bg: '#ffffff', fg: '#e0621f', font: 'rounded' },
  { name: 'Father & Sons', floor: 'Second_Floor', sign: 'FATHER\n& SONS', x: 37.8, z: -174.2, w: 11.2, h: 5, bg: '#1f1f1f', fg: '#e9e1cf', font: 'serif' },
  { name: 'Tarkovstar', floor: 'Second_Floor', sign: 'Tarkovstar', x: 69, z: -150, w: 16.5, h: 2.9, bg: '#0c1e46', fg: '#ffc93c', font: 'geometric-bold' },
  { name: 'Eastland', floor: 'Second_Floor', sign: 'EASTLAND', x: 26.3, z: -151.1, w: 11, h: 2.9, bg: '#1b2a4a', fg: '#ffffff', font: 'condensed-bold' },
  { name: 'Arena', floor: 'Second_Floor', sign: 'ARENA', x: 70.7, z: -137.2, w: 7.5, h: 2.9, bg: '#121212', fg: '#e53935', font: 'condensed-bold', italic: true },
  { name: 'ТАРЗДРАВ', floor: 'Second_Floor', sign: 'ТАРЗДРАВ', x: 54, z: -128, w: 16.5, h: 2.6, bg: '#2e9e48', fg: '#ffffff', font: 'geometric-bold', accent: 'cross', accentColor: '#ffffff' },
  { name: 'МЕБЕЛЬ МК', floor: 'Second_Floor', sign: 'МЕБЕЛЬ МК', x: 20, z: -128, w: 11.9, h: 2.9, bg: '#ffffff', fg: '#6d4126', font: 'condensed-bold' },
  { name: 'Intourist', floor: 'Second_Floor', sign: 'INTOURIST', x: 69, z: -116, w: 16.5, h: 2.8, bg: '#ffffff', fg: '#1f4e9c', font: 'serif', accent: 'stripe', accentColor: '#d0102a' },
  { name: 'Burger Spot', floor: 'Second_Floor', sign: 'BURGER\nSPOT', x: -27, z: -103, w: 11.5, h: 5.3, bg: '#1d4fa0', fg: '#e4322b', font: 'rounded' },
  { name: 'FCK', floor: 'Second_Floor', sign: 'FCK', x: 70, z: -94, w: 6.6, h: 2.9, bg: '#c8102e', fg: '#ffffff', font: 'serif' },
  { name: 'McDaniels', floor: 'Second_Floor', sign: 'McDaniels', x: 70, z: -87, w: 14, h: 2.9, bg: '#d52b1e', fg: '#ffc72c', font: 'rounded' },
  { name: 'Tarducks', floor: 'Second_Floor', sign: 'TARDUCKS', x: 64, z: -69, w: 16, h: 2.9, bg: '#00704a', fg: '#ffffff', font: 'geometric-bold' },
  { name: 'Coffee Joy', floor: 'Second_Floor', sign: 'Coffee Joy', x: 43, z: -69, w: 15.2, h: 2.9, bg: '#4b2e1e', fg: '#f4e4c4', font: 'script' },
  { name: 'Jacob & Jacob', floor: 'Second_Floor', sign: 'jacob&jacob', x: 18, z: -76.6, w: 16.6, h: 2.9, bg: '#dde6e8', fg: '#10232b', font: 'slab' },
  { name: 'ПУШКИН', floor: 'Second_Floor', sign: 'ПУШКИН', x: -32.7, z: -81.1, w: 2.9, h: 11.8, vertical: true, bg: '#1f3a2c', fg: '#d8b766', font: 'serif' },
  { name: 'Sushi Huyushi', floor: 'Second_Floor', sign: 'Sushi Huyushi', x: 64, z: -34, w: 15.5, h: 2.9, bg: '#111111', fg: '#ffffff', font: 'condensed-bold' },
  { name: 'Underway', floor: 'Second_Floor', sign: 'UNDERWAY', x: -17, z: -32, w: 16, h: 2.9, bg: '#008c45', fg: '#ffffff', font: 'geometric-bold', italic: true, accent: 'stripe', accentColor: '#ffc20e' },
  { name: 'Burger House', floor: 'Second_Floor', sign: 'BURGER\nHOUSE', x: 67, z: -23.5, w: 11.8, h: 5.3, bg: '#2a1a10', fg: '#f5a623', font: 'slab' },
  { name: 'Philly Cute', floor: 'Second_Floor', sign: 'Philly Cute', x: -32.6, z: -28.8, w: 2.9, h: 16.5, vertical: true, bg: '#fff4e6', fg: '#d7263d', font: 'script' },
  { name: 'Shiccos', floor: 'Second_Floor', sign: 'Shiccos', x: 67, z: -16, w: 11, h: 2.9, bg: '#ffffff', fg: '#1d4fa0', font: 'rounded' },
  { name: 'МУЗЕЙ ИСТОРИИ', floor: 'Second_Floor', sign: 'МУЗЕЙ\nИСТОРИИ', x: 22.6, z: -3.4, w: 13.5, h: 5.3, bg: '#3a2a1c', fg: '#e8d5a6', font: 'serif' },
  { name: 'Papillon', floor: 'Second_Floor', sign: 'PAPILLON', x: 94.7, z: 10.1, w: 2.9, h: 12.5, vertical: true, bg: '#1c1c1c', fg: '#f2f2f2', font: 'thin-sans' },
  { name: 'ЗАКРЫТО НА РЕМОНТ', floor: 'Second_Floor', sign: 'ЗАКРЫТО НА РЕМОНТ', x: 47.7, z: 3.7, w: 21.1, h: 2.9, bg: '#f2f2f2', fg: '#c0272d', font: 'condensed-bold' },
  { name: 'НА-СВЯЗИ', floor: 'Second_Floor', sign: 'НА-СВЯЗИ', x: 72.4, z: 26.8, w: 2.9, h: 15.8, vertical: true, bg: '#ffd400', fg: '#1a1a1a', font: 'geometric-bold' },
  { name: 'СКОРО ОТКРЫТИЕ', floor: 'Second_Floor', sign: 'СКОРО\nОТКРЫТИЕ', x: 55.5, z: 24.3, w: 5.3, h: 11.1, vertical: true, bg: '#ffffff', fg: '#1a1a1a', font: 'condensed-bold' },
  { name: 'Figaro', floor: 'Second_Floor', sign: 'Figaro', x: 22.7, z: 25.1, w: 9.9, h: 2.9, bg: '#151515', fg: '#e7d3a1', font: 'script' },
  { name: 'АПТЕКА', floor: 'Second_Floor', sign: 'АПТЕКА', x: 71, z: 47, w: 15, h: 2.9, bg: '#f2f2ee', fg: '#161616', font: 'geometric-bold', accent: 'cross', accentColor: '#3ba44a' },
  { name: 'SARA', floor: 'Second_Floor', sign: 'SARA', x: 53, z: 47, w: 8.4, h: 2.9, bg: '#ffffff', fg: '#000000', font: 'serif' },
  { name: 'Urban Clothes', floor: 'Second_Floor', sign: 'URBAN\nCLOTHES', x: 26.3, z: 41.3, w: 9.9, h: 5.3, bg: '#1e140c', fg: '#f2b544', font: 'condensed-bold' },
  { name: 'TECHLIGHT', floor: 'Second_Floor', sign: 'TECHLIGHT', x: 94.7, z: 51, w: 2.9, h: 13.9, vertical: true, bg: '#c6262e', fg: '#2a0f10', font: 'thin-sans' },
  { name: 'Fashion Store', floor: 'Second_Floor', sign: 'FASHION STORE', x: 38, z: 64.9, w: 18.8, h: 2.9, bg: '#f5f5f5', fg: '#111111', font: 'thin-sans' },
]
