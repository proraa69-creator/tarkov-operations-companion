/**
 * «Как работает баллистика» (BallisticsGuide.tsx), in the words the English dictionary knows (uiEnglishArsenal.ts). Each point
 * starts with its bold words, up to its first « — », in every language (src/i18n/locales/*.json keep that dash); a point may
 * have a short list under it and a line after that list.
 * Checked against the official EFT wiki, «Ballistics» (owner, 28.11.2026: «частично он написан неправильно… более понятным языком»;
 * «Пробьёт ли» in his own words: «"Ориентир класс × 10" — что это значит, никто ничего не поймет… перефразируй»).
 */
export const BALLISTICS_GUIDE_TITLE = 'Как работает баллистика'

export interface GuidePoint {
  readonly text: string
  readonly items?: readonly string[]
  readonly after?: string
}

export const BALLISTICS_GUIDE_POINTS: readonly GuidePoint[] = [
  { text: 'Урон — зависит только от патрона, а не от оружия. С расстоянием пуля замедляется, падает и теряет урон и пробитие.' },
  { text: 'Броня — не уменьшает урон, а либо останавливает пулю целиком, либо пропускает её. Защищает только свои зоны (видно при осмотре предмета); подмышки не защищены никакой бронёй.' },
  {
    text: 'Пробьёт ли — у брони есть класс защиты от 1 до 6 (виден при осмотре брони в игре), у патрона — число «Пробитие» (оно есть в «Списке патронов»). Умножьте класс брони на 10 — столько пробития нужно, чтобы уверенно пробивать новую броню. Например, для брони 4 класса:',
    items: [
      'пробитие 40 и больше — пробивает почти всегда (9 раз из 10 и чаще);',
      'от 26 до 39 — иногда: чем ближе к 40, тем чаще;',
      '25 и меньше — не пробьёт, пока броня целая.',
    ],
    after: 'Поношенную броню пробить легче. Угол попадания значения не имеет.',
  },
  { text: 'Прочность — чем она ниже, тем легче пробить броню. Каждое попадание снимает прочность — больше у патронов с высоким пробитием и «уроном броне». Керамика изнашивается быстрее всего, арамид — медленнее; даже одна дробина снимает минимум 1.' },
  { text: 'Если пробила — пуля теряет от 0 до 40 % урона (обычно около 20 %) и часть пробития и идёт дальше: пластина → мягкая броня → тело.' },
  { text: 'Если не пробила — в тело проходит небольшой «тупой» урон; мягкая броня под пластиной уменьшает и его. Обычно он почти не влияет на то, как быстро убивают.' },
  { text: 'Рикошет — только от шлемов: под острым углом пуля может отскочить, углы и шанс у каждого шлема свои. Рикошет — это непробитие: урона почти нет, шлем теряет 1 прочности.' },
  { text: 'Кровотечение и осколки — у патронов есть шанс лёгкого и тяжёлого кровотечения, а у некоторых — шанс разлететься в теле на осколки и нанести дополнительный урон.' },
]

/** Every text of the window after its title, in order: each point, its list and its line after the list. */
export const guideTexts = () => BALLISTICS_GUIDE_POINTS.flatMap((point) => [point.text, ...(point.items ?? []), ...(point.after ? [point.after] : [])])

/** A point drawn in its language: the bold words before its first « — » and the rest; no dash, no bold words. */
export function guidePointParts(text: string): { lead: string; rest: string } {
  const at = text.indexOf(' — ')
  return at > 0 ? { lead: text.slice(0, at), rest: text.slice(at + 3) } : { lead: '', rest: text }
}
