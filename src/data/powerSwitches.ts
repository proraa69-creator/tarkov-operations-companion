/**
 * Power switches (рубильники) on the maps: the levers that turn on an exit or the power, from tarkov.dev `<mode>/maps`
 * `switches` (owner, 02.11.2026: «рубильник включения выхода Д-2 на Резерве… и гермозатвор… на всех картах добавь эти
 * обозначения»). tarkov.dev lists every interactive switch there (lift call buttons, alarm consoles, a urinal on
 * Interchange); only the levers below are drawn, by their tarkov.dev id, each with what it turns on.
 *
 * Reserve: the D-2 lever (switch_autoId_00000_D2_LEVER) unlocks the gate button by the D-2 exit; the other lever
 * (switch_autoId_00632_EXFIL) is the hermetic door's, the only other Reserve exit that needs switching on.
 * Interchange: the power station lever and the lever by the «Saferoom» exit door. The Lab: the power levers the exits
 * and the lifts list. The Labyrinth: the trap switches.
 */
export interface PowerSwitch { title: string; description: string }

const D2 = { title: 'Рубильник выхода D-2', description: 'Опустите рубильник в бункере: откроется выход D-2. Затем нажмите кнопку у ворот выхода.' }
const LAB_POWER = { title: 'Рубильник питания', description: 'Включает питание лифтов и выходов Лаборатории.' }
const LAB_LIFT = { title: 'Рубильник питания', description: 'Включает кнопку вызова лифта.' }
const TRAPS = { title: 'Рубильник ловушек', description: 'Отключает ловушки рядом.' }

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
  // The Labyrinth
  bcfc84e5f79404bd840676050525ec5e44cfbb76: TRAPS,
  a0296ed1d29971b48190ab776b8940c57a56d4cd: TRAPS,
}
