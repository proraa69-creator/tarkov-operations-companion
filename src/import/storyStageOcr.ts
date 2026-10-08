import type { Quest, QuestStage } from '../domain/types'
import { foldOcrGlyphs, ocrKey } from './questOcr'

/**
 * Infer the active story stage from Tasks → Story detail OCR
 * (main/optional objectives, counters like 0/3).
 */
export function inferStoryStageIndex(text: string, quest: Quest): number | undefined {
  if (quest.kind !== 'story' || !quest.stages?.length) return undefined
  const objectives = objectivesSection(text)
  if (!objectives) return undefined
  const haystack = ocrKey(objectives)
  const folded = foldOcrGlyphs(objectives.toLowerCase())
  // Keep digits intact for counters like 0/3 (foldOcrGlyphs turns 3→з).
  const plain = objectivesSection(text, true).toLowerCase().replace(/ё/g, 'е')

  const hits: Array<{ index: number; score: number; done: boolean; talk: boolean }> = []
  quest.stages.forEach((stage, index) => {
    // Words from separate objectives must not combine into a fictional later stage.
    const lines = objectives.split(/\r?\n/).filter((line) => line.trim())
    const score = Math.max(0, ...lines.map((line, position) => {
      const wrapped = `${line} ${lines[position + 1] ?? ''}`
      // «Узнать больше о жертве» inside «Узнать больше о жертве культистов из пыточной» is the longer stage's text,
      // not a sighting of the shorter, earlier one.
      return Math.max(stageMatchScore(stage, maskLongerStageTitles(quest.stages!, index, ocrKey(line)), foldOcrGlyphs(line.toLowerCase())),
        exactStageScore(stage, wrapped, quest.stages, index))
    }))
    if (score < 0.55) return
    hits.push({
      index,
      score,
      done: stageLooksComplete(stage, plain, folded, haystack),
      talk: !stage.mapIds.length,
    })
  })
  if (!hits.length) return undefined
  dropAmbiguousRepeats(hits, quest.stages)

  const incomplete = hits.filter((hit) => !hit.done)
  // A finished counter is not evidence that the next objective is open.
  if (!incomplete.length) return undefined

  // Only stages read about as well as the best one compete: a stage whose words were merely scattered over other
  // lines («…отряде «Богатыри»» in several Batya stages) must never beat the objective written out in full.
  const best = Math.max(...incomplete.map((hit) => hit.score))
  const strong = incomplete.filter((hit) => hit.score >= best - 0.08)
  // Several mandatory objectives may be visible together. Never skip an earlier unfinished one.
  return strong.sort((a, b) => a.index - b.index)[0]?.index
}

/**
 * Repeated titles («Поговорить с Лыжником» twice in Tour): a later copy only counts when the
 * stage before it is visible too; otherwise keep the earliest copy.
 */
function dropAmbiguousRepeats(hits: Array<{ index: number; done: boolean }>, stages: QuestStage[]) {
  const hitIndexes = new Set(hits.filter((hit) => hit.done).map((hit) => hit.index))
  const byTitle = new Map<string, number[]>()
  for (const hit of hits) {
    const key = ocrKey(stages[hit.index]?.title ?? '')
    byTitle.set(key, [...(byTitle.get(key) ?? []), hit.index])
  }
  const keep = new Set<number>()
  for (const indexes of byTitle.values()) {
    const sorted = [...indexes].sort((a, b) => a - b)
    const supported = sorted.filter((index) => index > 0 && hitIndexes.has(index - 1))
    keep.add(supported.length ? supported[supported.length - 1]! : sorted[0]!)
  }
  for (let position = hits.length - 1; position >= 0; position -= 1) {
    if (!keep.has(hits[position]!.index)) hits.splice(position, 1)
  }
}

/**
 * Strong proof that this chapter's detail pane is open: a long stage title / alias (≥14 letters)
 * appears verbatim in the objectives block. Returns that stage index.
 */
export function storyStageEvidence(text: string, quest: Quest): number | undefined {
  if (quest.kind !== 'story' || !quest.stages?.length) return undefined
  const haystack = ocrKey(objectivesSection(text))
  let found: number | undefined
  quest.stages.forEach((stage, index) => {
    if (found != null) return
    const keys = [stage.title, ...(stage.ocrAliases ?? [])].map(ocrKey).filter((key) => key.length >= 14)
    if (keys.some((key) => haystack.includes(key))) found = index
  })
  return found
}

export function hasExactStoryStageEvidence(text: string, quest: Quest, index: number) {
  const stage = quest.stages?.[index]
  return Boolean(stage && exactStageScore(stage, objectivesSection(text), quest.stages, index))
}

/**
 * Every stage of the chapter that the same on-screen text can belong to, in order; just `[index]` when the text is
 * unique. «Поговорить с Лыжником» is stage 6 and 12 of «Тур»; «Построить Солнечную электростанцию 1-го уровня» is an
 * objective of stage 24, 66 and 91 of «Билет». With `text`, only the titles / aliases of stage `index` that are really
 * on screen count. The pane shows the text only, so which copy is meant is decided against the saved progress
 * (storyScan.ts), never by taking the first copy.
 */
export function storyStageCopies(quest: Quest, index: number, text?: string): number[] {
  const stages = quest.stages ?? []
  const own = stageKeys(stages[index]).filter((key) => key.length >= 8)
  const screen = text == null ? undefined : ocrKey(text)
  const visible = screen == null ? own : own.filter((key) => screen.includes(key))
  if (!visible.length) return [index]
  return stages.flatMap((stage, position) => position === index || stageKeys(stage).some((key) => visible.includes(key)) ? [position] : [])
}

/**
 * The OCR key with every title / alias of ANOTHER stage removed when it is longer than, and contains, a title / alias of
 * stage `index`: what is left is evidence for this stage that the longer title does not already explain.
 */
export function maskLongerStageTitles(stages: QuestStage[], index: number, key: string) {
  const own = stageKeys(stages[index]).filter((value) => value.length >= 6)
  if (!own.length) return key
  let masked = key
  stages.forEach((other, position) => {
    if (position === index) return
    for (const longer of stageKeys(other)) {
      if (own.some((value) => longer.length > value.length && longer.includes(value)) && masked.includes(longer)) masked = masked.split(longer).join('|')
    }
  })
  return masked
}

function stageKeys(stage: QuestStage | undefined) {
  return stage ? [stage.title, ...(stage.ocrAliases ?? [])].map(ocrKey).filter(Boolean) : []
}

/** The «Главные задачи» block of a story pane (without the optional objectives). */
export function storyObjectivesBlock(text: string) {
  return objectivesSection(text)
}

/** Prefer the «Главные задачи» block so trader chrome / chapter list do not steal the stage. */
function objectivesSection(text: string, includeOptional = false) {
  // The left edge of the pane can be cut: «вные задачи» / «ные задачи» still mark the block.
  const match = text.match(/(?:главн(?:ые|ая)|(?<![а-яё])[а-яё]{0,4}ные)\s*задач[^\r\n]*|main\s+(?:tasks|objectives)/i)
  if (!match || match.index == null) return ''
  const block = text.slice(match.index + match[0].length, match.index + 4000)
    .split(/(?:связанные\s*предметы|стартовое\s*снаряжение|награды|related\s*items|rewards)/i)[0]!
  return includeOptional ? block : block.split(/(?:опциональн|(?<![а-яё])[а-яё]{0,4}иональн)[а-яё]*\s*задач[^\r\n]*|optional\s+(?:tasks|objectives)/i)[0]!
}

/** 1 when a long title / alias of the stage is in `text`; with `stages`, not counting longer titles of other stages. */
function exactStageScore(stage: QuestStage, text: string, stages?: QuestStage[], index?: number) {
  const key = stages && index != null ? maskLongerStageTitles(stages, index, ocrKey(text)) : ocrKey(text)
  return [stage.title, ...(stage.ocrAliases ?? [])].some((alias) => {
    const needle = ocrKey(alias)
    return needle.length >= 14 && key.includes(needle)
  }) ? 1 : 0
}

/** Completed stages only count when their own objective and matching completion evidence are visible. */
export function completedStoryStageIndexes(text: string, quest: Quest): number[] {
  const main = objectivesSection(text)
  const all = objectivesSection(text, true)
  if (!main) return []
  return (quest.stages ?? []).flatMap((stage, index) => (
    exactStageScore(stage, main, quest.stages, index) && stageLooksComplete(stage, all.toLowerCase().replace(/ё/g, 'е'), '', ocrKey(all)) ? [index] : []
  ))
}

function stageMatchScore(stage: QuestStage, haystack: string, folded: string) {
  const aliases = [stage.title, ...(stage.ocrAliases ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
  let best = 0
  const talkOnly = !stage.mapIds.length
  for (const alias of aliases) {
    const key = ocrKey(alias)
    if (key.length >= 6 && haystack.includes(key)) {
      best = Math.max(best, Math.min(1, 0.72 + key.length / 80))
      continue
    }
    // Talk stages need a near-full phrase — a lone trader name must not win.
    if (talkOnly) {
      const words = alias.toLowerCase().split(/\s+/).filter((word) => word.length >= 5)
      if (words.length < 2) continue
      const wordHits = words.filter((word) => folded.includes(foldOcrGlyphs(word)) || haystack.includes(ocrKey(word))).length
      if (wordHits === words.length) best = Math.max(best, 0.68)
      continue
    }
    // Short map names («Лес») are the distinguishing word of a survive stage — keep them.
    const words = alias.toLowerCase().split(/\s+/).filter((word) => word.length >= 5 || (word.length >= 3 && !/^(или|раз|для|при|над|под|все|3)$/.test(word)))
    if (words.length < 2) continue
    const wordHits = words.filter((word) => folded.includes(foldOcrGlyphs(word)) || haystack.includes(ocrKey(word))).length
    if (wordHits === words.length) best = Math.max(best, 0.7 + words.length * 0.04)
    else if (wordHits / words.length >= 0.75 && words.length >= 3) best = Math.max(best, 0.62)
  }
  // Strong boost for Interchange extract/visit wording from the live Tasks UI.
  if (stage.mapIds.includes('interchange') && /развязк/.test(folded) && /(выжит|выйт|посетит|локаци)/.test(folded)) {
    best = Math.max(best, 0.98)
  }
  return best
}

function stageLooksComplete(stage: QuestStage, plain: string, _folded: string, haystack: string) {
  const total = stage.progressTotal
  if (total && total > 1) {
    const progress = findProgress(plain, stage)
    if (progress && progress.total === total && progress.current === total) return true
    if (progress && progress.total === total && progress.current < total) return false
  }
  const lines = plain.split(/\r?\n/).filter((line) => line.trim())
  for (let index = 0; index < lines.length; index += 1) {
    if (!exactStageScore(stage, lines[index]!)) continue
    if (/(?:выполнено|готово|completed)\s*[.!]?\s*$/i.test(lines[index]!)
      || /^\s*(?:выполнено|готово|completed)\s*[.!]?\s*$/i.test(lines[index + 1] ?? '')) return true
  }
  return false
}

function findProgress(plain: string, stage: QuestStage) {
  if (stage.progressTotal) {
    const mapWord = ({ interchange: 'развязк', woods: 'лес', factory: 'завод', customs: 'таможн', shoreline: 'берег' } as Record<string, string>)[stage.mapIds[0] ?? ''] ?? ''
    if (mapWord) {
      const matches = [...plain.matchAll(new RegExp(`${mapWord}[\\s\\S]{0,96}?(\\d{1,2})\\s*/\\s*(\\d{1,2})`, 'g'))]
      if (matches.length) {
        const last = matches[matches.length - 1]!
        if (Number(last[2]) === stage.progressTotal) return { current: Number(last[1]), total: Number(last[2]) }
      }
    }
  }

  const needles = [stage.title, ...(stage.ocrAliases ?? [])]
    .map((value) => value.toLowerCase().replace(/ё/g, 'е'))
    .filter((value) => value.length >= 5)
  for (const needle of needles) {
    let from = 0
    while (from < plain.length) {
      const idx = plain.indexOf(needle.slice(0, Math.min(needle.length, 20)), from)
      if (idx < 0) break
      const window = plain.slice(idx, idx + Math.max(needle.length, 20) + 96)
      const match = window.match(/(\d{1,2})\s*\/\s*(\d{1,2})/)
      if (match) return { current: Number(match[1]), total: Number(match[2]) }
      from = idx + 1
    }
  }
  return null
}
