import { battlePassDocumentPhrases } from '../data/battlePassDocuments'
import { storyPhrases } from '../data/storyChapters'

/**
 * English for game data the app curates itself: story chapter stages (src/data/storyChapterSeeds.ts) and
 * battle pass document points (src/data/battlePassDocuments.ts). Built from the same data, so every Russian
 * text there has its English pair.
 */
export const GAME_DATA_PHRASES: Array<[string, string]> = [
  ...storyPhrases(),
  ...battlePassDocumentPhrases(),
  // Tour stages whose Russian text changed with the exact Terminal point (src/data/storyChapters.ts).
  ['Берег, западный край карты (дальше радиовышки): подход к порту у сторожевой вышки.', 'Shoreline, the western edge of the map (past the radio tower): the port approach by the watchtower.'],
  ['Интерком у сторожевой вышки перед Терминалом (западный край Берега).', 'The intercom by the watchtower in front of the Terminal (western edge of Shoreline).'],
]
