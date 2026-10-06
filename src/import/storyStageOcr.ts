import type { Quest, QuestStage } from '../domain/types'
import { foldOcrGlyphs, ocrKey } from './questOcr'

/**
 * Infer the active story stage from Tasks → Story detail OCR
 * (main/optional objectives, counters like 0/3).
 */
export function inferStoryStageIndex(text: string, quest: Quest): number | undefined {
  if (quest.kind !== 'story' || !quest.stages?.length) return undefined
  const objectives = objectivesSection(text)
  const haystack = ocrKey(objectives)
  const folded = foldOcrGlyphs(objectives.toLowerCase())
  // Keep digits intact for counters like 0/3 (foldOcrGlyphs turns 3→з).
  const plain = objectives.toLowerCase().replace(/ё/g, 'е')

  // Live Tasks UI: Interchange survive/visit is Tour stage 5 (index 4). Only the objectives
  // block counts — the quest list beside it also shows «Развязка» and «Любая локация».
  const interchangeIndex = quest.stages.findIndex((stage) => stage.mapIds.includes('interchange'))
  const interchangeVisible = interchangeIndex >= 0 && /развязк/.test(folded) && /(выжи[тл]|вый[тд]|посетит)/.test(folded)
  if (interchangeVisible) {
    const stage = quest.stages[interchangeIndex]!
    if (!stageLooksComplete(stage, plain, folded, haystack)) return interchangeIndex
  }

  const hits: Array<{ index: number; score: number; done: boolean; talk: boolean }> = []
  quest.stages.forEach((stage, index) => {
    const score = stageMatchScore(stage, haystack, folded)
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
  if (!incomplete.length) {
    const lastDone = Math.max(...hits.filter((hit) => hit.done).map((hit) => hit.index), -1)
    if (lastDone >= 0) return Math.min(lastDone + 1, quest.stages.length - 1)
    return hits.sort((a, b) => b.score - a.score)[0]?.index
  }

  // Only stages read about as well as the best one compete: a stage whose words were merely scattered over other
  // lines («…отряде «Богатыри»» in several Batya stages) must never beat the objective written out in full.
  const best = Math.max(...incomplete.map((hit) => hit.score))
  const strong = incomplete.filter((hit) => hit.score >= best - 0.08)
  // Among those, prefer map/raid objectives over «поговорить с …» (the UI lists prior talks).
  const mapHits = strong.filter((hit) => !hit.talk)
  const pool = mapHits.length ? mapHits : strong
  return pool.sort((a, b) => b.score - a.score || b.index - a.index)[0]?.index
}

/**
 * Repeated titles («Поговорить с Лыжником» twice in Tour): a later copy only counts when the
 * stage before it is visible too; otherwise keep the earliest copy.
 */
function dropAmbiguousRepeats(hits: Array<{ index: number }>, stages: QuestStage[]) {
  const hitIndexes = new Set(hits.map((hit) => hit.index))
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

/** Prefer the «Главные задачи» block so trader chrome / chapter list do not steal the stage. */
function objectivesSection(text: string) {
  // The left edge of the pane can be cut: «вные задачи» / «ные задачи» still mark the block.
  const match = text.match(/(?:главн(?:ые|ая)|(?<![а-яё])[а-яё]{0,4}ные)\s*задач[\s\S]{0,1200}/i)
  if (match) return match[0]
  const optional = text.match(/опциональн[\s\S]{0,800}/i)
  if (optional) return optional[0]
  return text
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
    if (progress && progress.current >= progress.total) return true
    if (progress && progress.current < progress.total) return false
  }
  const titleKey = ocrKey(stage.title)
  if (titleKey.length >= 8 && new RegExp(`${titleKey}.{0,24}(выполн|готово|completed)`, 'i').test(haystack)) return true
  return false
}

function findProgress(plain: string, stage: QuestStage) {
  if (stage.progressTotal) {
    const mapWord = ({ interchange: 'развязк', woods: 'лес', factory: 'завод', customs: 'таможн', shoreline: 'берег' } as Record<string, string>)[stage.mapIds[0] ?? ''] ?? ''
    if (mapWord) {
      const matches = [...plain.matchAll(new RegExp(`${mapWord}[\\s\\S]{0,96}?(\\d{1,2})\\s*/\\s*(\\d{1,2})`, 'g'))]
      if (matches.length) {
        const last = matches[matches.length - 1]!
        return { current: Number(last[1]), total: Number(last[2]) }
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
