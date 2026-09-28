import type { AppDataset, Quest } from '../domain/types'

const ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…', times: '×',
}

/** UTF-8 Cyrillic that was decoded as Latin-1/CP1252 ("Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ"). */
const MOJIBAKE = /[ÐÑ][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u2026\u2030\u2039\u203A\u20AC\u2122]/

const CP1252_BYTES: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

function repairMojibake(value: string) {
  if (!MOJIBAKE.test(value)) return value
  const bytes: number[] = []
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x100) bytes.push(code)
    else if (CP1252_BYTES[char] !== undefined) bytes.push(CP1252_BYTES[char])
    else return value
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return /[а-яё]/i.test(decoded) ? decoded : value
  } catch {
    return value
  }
}

function stripTemplates(value: string) {
  let result = value
  for (let pass = 0; pass < 6 && /\{\{[^{}]*\}\}/.test(result); pass += 1) {
    result = result.replace(/\{\{\s*(?:quote|цитата|nowrap|nobr)\s*\|([^{}]*)\}\}/gi, '$1')
      .replace(/\{\{[^{}]*\}\}/g, '')
  }
  return result.replace(/\{\{|\}\}/g, '')
}

/** Removes wiki markup, HTML, broken encodings and stray symbols from quest text. */
export function cleanQuestText(raw: string | undefined): string {
  if (!raw) return ''
  let value = repairMojibake(String(raw))
  value = value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{\s*(?:Инфобокс квест|Infobox quest)[\s\S]*?\n\}\}/gi, '')
    .replace(/\{\|[\s\S]*?\|\}/g, ' ')
    .replace(/<gallery[\s\S]*?<\/gallery>/gi, ' ')
    .replace(/\[\[:?[a-z]{2}:[^\]]*\]\]/gi, '')
    .replace(/\(\s*:?[a-z]{2}:[^)]*\)/gi, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith('#')) {
        const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : ''
      }
      return ENTITIES[entity.toLowerCase()] ?? match
    })
  value = stripTemplates(value)
    .replace(/\[\[(?:file|файл|image|изображение|категория|category):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/[^\]]+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/^\s*=+\s*|\s*=+\s*$/g, '')
    .replace(/^\s*[*#:;]+\s*/, '')
    .replace(/[\u200B-\u200F\u2028\u2029\u2060\uFEFF\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s*\|\s*/g, ' ')
    .replace(/\[\]|\(\s*\)|«\s*»|"\s*"/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return value
}

const LEFTOVER_MARKUP = /\{\{|\}\}|\[\[|\]\]|\{\||\|\}|^\s*\||[\wа-яё]+\s*=\s*\S+\.(png|jpe?g|gif|webp)|:en:|Ð.|Ñ.|â€|Ã.|\uFFFD|- квест в escape from tarkov/i

/** Rejects text that still carries wiki / encoding debris after cleanup. */
export function isCleanText(value: string | undefined) {
  return Boolean(value) && value!.length >= 8 && !LEFTOVER_MARKUP.test(value!)
}

function cleanList(values: string[] | undefined) {
  return [...new Set((values ?? []).map(cleanQuestText).filter((entry) => entry.length > 1 && !LEFTOVER_MARKUP.test(entry)))]
}

export function cleanQuest(quest: Quest): Quest {
  const description = cleanQuestText(quest.description)
  return {
    ...quest,
    name: cleanQuestText(quest.name) || quest.name,
    description: isCleanText(description) ? description : quest.kind === 'story' ? '' : `Задание от торговца ${quest.trader}.`,
    objectives: cleanList(quest.objectives),
    rewards: cleanList(quest.rewards),
    stages: quest.stages?.map((stage) => ({
      ...stage,
      title: cleanQuestText(stage.title) || stage.title,
      description: cleanQuestText(stage.description),
      landmarkHints: stage.landmarkHints ? cleanList(stage.landmarkHints) : undefined,
    })),
  }
}

export function cleanDatasetText(dataset: AppDataset): AppDataset {
  return { ...dataset, quests: dataset.quests.map(cleanQuest) }
}
