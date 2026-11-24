// @vitest-environment node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import { fetchLiveCatalog } from '../../data/catalogSource'
import { withQuestGrid } from '../../data/questGrid'
import type { Quest, RaidMode } from '../../domain/types'

/**
 * Rewrites src/quests/tree/questTree.catalog.fixture.json, the real quests of all three modes that the tree's tests stand on,
 * from the live catalog through the app's own pipeline. Skipped in a normal run; to refresh:
 *   RAIDOS_QUEST_TREE_FIXTURE=1 npx vitest run src/quests/tree/questTreeFixture.gen.test.ts
 */
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

const row = (quest: Quest) => ({
  id: quest.id,
  name: quest.name,
  trader: quest.trader,
  ...(quest.traderId ? { traderId: quest.traderId } : {}),
  ...(quest.normalizedName ? { normalizedName: quest.normalizedName } : {}),
  level: quest.level,
  ...(quest.kappa ? { kappa: true } : {}),
  ...(quest.kind ? { kind: quest.kind } : {}),
  ...(quest.storyOrder !== undefined ? { storyOrder: quest.storyOrder } : {}),
  ...(quest.storyChapterId ? { storyChapterId: quest.storyChapterId } : {}),
  ...(quest.requirements?.length ? { requirements: quest.requirements } : {}),
  ...(!quest.requirements && quest.previous?.length ? { previous: quest.previous } : {}),
  ...(quest.unlock ? { unlock: quest.unlock } : {}),
  ...(quest.traderLoyalty?.needed.length ? { traderLoyalty: { needed: quest.traderLoyalty.needed, reached: [] } } : {}),
  ...(quest.helpView?.ll ? { helpView: { ll: quest.helpView.ll } } : {}),
})

describe.skipIf(!process.env.RAIDOS_QUEST_TREE_FIXTURE)('quest tree fixture', () => {
  it('writes the real catalog of every mode', async () => {
    const rows: string[] = []
    const places = new Map<string, number>()
    const modes: Record<string, number[]> = {}
    for (const mode of MODES) {
      const dataset = withQuestGrid(await fetchLiveCatalog(mode, 'ru'), mode)
      modes[mode] = dataset.quests.map((quest) => {
        const text = JSON.stringify(row(quest))
        let place = places.get(text)
        if (place === undefined) {
          place = rows.length
          rows.push(text)
          places.set(text, place)
        }
        return place
      })
    }
    const out = `{\n"takenAt":${JSON.stringify(new Date().toISOString())},\n"modes":${JSON.stringify(modes)},\n"quests":[\n${rows.join(',\n')}\n]\n}\n`
    writeFileSync(join(process.cwd(), 'src/quests/tree/questTree.catalog.fixture.json'), out)
  }, 600_000)
})
