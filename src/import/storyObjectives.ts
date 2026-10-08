import type { Quest, StoryObjectiveReading } from '../domain/types'
import { ocrKey } from './questOcr'

const MAIN = /^(?:(?:главн(?:ые|ая)|[а-яё]{0,4}ные)\s*задач[^\n]*|main\s+(?:tasks|objectives))$/i
const OPTIONAL = /^(?:(?:опциональн|[а-яё]{0,4}иональн)[а-яё]*\s*задач[^\n]*|optional\s+(?:tasks|objectives))$/i
const END = /^(?:связанные\s*предметы|стартовое\s*снаряжение|награды|related\s*items|rewards|rarity|редкость|[\d.]+\s|[=\s]*главное\s*меню)/i
const START = /^(?:най[тд]и|на[йи]дите|получ|переда|собра|поговор|рассказ|обеспеч|вы[жй]|вый|выбр|посет|уби|осмотр|отыск|дост|разб|унич|узна|связ|прин|прослед|повыс|find|locate|obtain|collect|hand|give|survive|visit|eliminate|kill|talk|inspect|reach|gain|follow)/i

/** Read the objectives pane only. Unknown objectives remain readable, but get no invented map point. */
export function readStoryObjectives(text: string, quest: Quest): StoryObjectiveReading[] {
  const rows: Array<{ text: string; optional: boolean }> = []
  let active = false
  let optional = false
  for (const raw of text.slice(0, 20000).split(/\r?\n/)) {
    let line = raw.trim().replace(/^(?:\[[^\]]{0,3}\]|[•●○✓✔☑\-*]+|(?:CJ|СJ|CП|□))\s*/, '').trim()
    const checkbox = line.match(/^.{1,3}\s+(.+)$/)
    if (checkbox && START.test(checkbox[1]!)) line = checkbox[1]!
    if (MAIN.test(line)) { active = true; optional = false; continue }
    if (!active) continue
    if (OPTIONAL.test(line)) { optional = true; continue }
    if (END.test(line)) break
    if (/^предметы\s+для\s+заданий/i.test(line)) continue
    if (!line || line.length > 600) continue
    const last = rows.at(-1)
    if (last && last.optional === optional && /(?:или|и|на|из|в|категории)\s*$/i.test(last.text)) last.text += ` ${line}`
    else if (START.test(line)) rows.push({ text: line, optional })
    else if (last && last.optional === optional && /[а-яa-z\d]/i.test(line) && last.text.length + line.length < 600) last.text += ` ${line}`
    if (rows.length >= 40) break
  }
  const seen = new Set<string>()
  return rows.flatMap(({ text: row, optional }) => {
    const counter = row.match(/(?:^|\s)(\d{1,7})\s*\/\s*(\d{1,7})(?:\s|$)/)
    const current = counter ? Number(counter[1]) : undefined
    const total = counter ? Number(counter[2]) : undefined
    const validCounter = current != null && total != null && total > 0 && current <= total
    const completed = /(?:выполнено|готово|completed)\s*[.!]?\s*$/i.test(row) || (validCounter && current === total)
    // OCR sometimes appends isolated digits / checkbox fragments after the counter.
    const withoutTail = counter && /^[\s\d|.,:;-]*$/.test(row.slice(counter.index! + counter[0].length)) ? row.slice(0, counter.index) : row
    const label = withoutTail.replace(/(?:^|\s)\d{1,7}\s*\/\s*\d{1,7}(?=\s|$)/g, '').replace(/(?:выполнено|готово|completed)\s*[.!]?\s*$/i, '').trim()
    const key = ocrKey(label)
    if (key.length < 8 || seen.has(`${optional}:${key}`)) return []
    seen.add(`${optional}:${key}`)
    const candidates = (quest.stages ?? []).flatMap((stage, index) => {
      const length = Math.max(0, ...[stage.title, ...(stage.ocrAliases ?? [])].map(ocrKey)
        .filter(alias => (alias.length >= 14 && key.includes(alias)) || (alias.length >= 8 && key === alias)).map(alias => alias.length))
      return length ? [{ index, length }] : []
    }).sort((a, b) => b.length - a.length || a.index - b.index)
    // Repeated instructions can be displayed, but cannot select a later copy's map.
    const stageIndex = candidates[0]?.index
    return [{ id: `${optional ? 'optional' : 'main'}:${key}`, text: label, optional, completed,
      ...(stageIndex != null ? { stageIndex } : {}), ...(validCounter ? { current, total } : {}) }]
  })
}
