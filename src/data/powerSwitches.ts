/**
 * Power switches (рубильники) on the maps: the levers that turn on an exit or the power, from tarkov.dev `<mode>/maps`
 * `switches` (owner, 02.11.2026: «рубильник включения выхода Д-2 на Резерве… и гермозатвор… на всех картах добавь эти
 * обозначения»). tarkov.dev lists every interactive switch there (lift call buttons, alarm consoles, a urinal on
 * Interchange); only the levers below are drawn, by their tarkov.dev id, each with what it turns on.
 *
 * Reserve: the D-2 lever (switch_autoId_00000_D2_LEVER) unlocks the gate button by the D-2 exit; the other lever
 * (switch_autoId_00632_EXFIL) is the hermetic door's, the only other Reserve exit that needs switching on.
 * Interchange: the power station lever and the lever by the «Saferoom» exit door. The Lab: the power levers the exits
 * and the lifts list. The Labyrinth: what turns off each trap.
 */
export interface PowerSwitch { title: string; description: string }

const D2 = { title: 'Рубильник выхода D-2', description: 'Опустите рубильник в бункере: откроется выход D-2. Затем нажмите кнопку у ворот выхода.' }
const LAB_POWER = { title: 'Рубильник питания', description: 'Включает питание лифтов и выходов Лаборатории.' }
const LAB_LIFT = { title: 'Рубильник питания', description: 'Включает кнопку вызова лифта.' }

export const POWER_SWITCHES: Record<string, PowerSwitch> = {
  // Reserve
  '9cad024bc31223f02f7296c3cb1834c5f6fa2fe2': D2,
  '2c4a9ff1d031afefbd0965b189f58e3834cdb367': { title: 'Рубильник гермозатвора', description: 'Опустите рубильник: откроется выход «Гермозатвор бункера».' },
  // Customs
  ae4bdfc1fc5b30100701158b56ae4d20840e0550: { title: 'Рубильник электричества', description: 'Включает электричество на Таможне.' },
  // Interchange
  b6ebc39ee29cb6659334df309194b696bbfef555: { title: 'Рубильник электричества', description: 'Включает электричество в торговом центре: без него не открыть выход «Безопасная комната».' },
  a91897cf1f9ab86c1376fec5fdf8a921e491a1a4: { title: 'Рубильник безопасной комнаты', description: 'Открывает дверь выхода «Безопасная комната». Сначала включите электричество на электростанции.' },
  // The Lab
  '014e9122e0fad99bcff6f93161712c3c6e1a2a75': LAB_POWER,
  '911ef57b76415c1d42fdba3b5c8fdb587dd229a7': LAB_LIFT,
  c39cf1e7caac3b830c00b539ee12dfddeb061e2b: LAB_LIFT,
  // The Labyrinth: what turns off each spawn room's trap, and the doors the gas torch opens (owner, 06.11.2026).
  '826f3ecfc95273700aec28b1a61eaa470a6ebc90': { title: 'Кнопка ловушки. Комната 1', description: 'Отключает токсичный бассейн.' },
  '0f6a9ab8c77afe7609feaec4e2053c9e709a632f': { title: 'Вентиль ловушки. Комната 2', description: 'Нужен штурвал вентиля. Отключает пар.' },
  '8f955feb9400b5a67957b76d5c853b5431517b0d': { title: 'Кнопка ловушки. Комната 3', description: 'Отключает огонь.' },
  a8cb8a737ec186cd836b43128170e854b8bab750: { title: 'Дверь под резак. Комната 3', description: 'Нужен газовый резак.' },
  bcfc84e5f79404bd840676050525ec5e44cfbb76: { title: 'Рычаг ловушки. Комната 4', description: 'Отключает обрезы.' },
  a0296ed1d29971b48190ab776b8940c57a56d4cd: { title: 'Рычаг ловушки. Комната 5', description: 'Отключает токсичную лужу.' },
  '6bfdec06869b8a511144243c319bbe63d18cb888': { title: 'Дверь под резак. Комната 5', description: 'Нужен газовый резак.' },
}
