import { expect, test, type Page } from '@playwright/test'
import { createLocalProfile } from '../src/domain/progress'
import { applyObjectiveChange, appendEvents, taskStatusEvents } from '../src/progression/objectiveProgress'
import type { ObjectiveProgress } from '../src/domain/types'

// Offline: json.tarkov.dev answers from the fixture below (tarkov.dev shapes), everything else external is aborted.
const TASK = '5c0d4c12d09282029f539173'
const TRADER = '5935c25fb3acc3127c3d8cd9'
const CUSTOMS = '56f40101d2720b2a4d8b45d6'
const OBJ = { visit: '5c0d4c12d09282029f539175', shoot: '5c0d4c12d09282029f539177', give: '5c0d4c12d09282029f539178' }

const catalog: Record<string, unknown> = {
  tasks: {
    tasks: {
      [TASK]: {
        id: TASK, name: 'Peacekeeping Mission', normalizedName: 'peacekeeping-mission', trader: TRADER, map: CUSTOMS, minPlayerLevel: 10,
        kappaRequired: true, experience: 9000, taskRequirements: [], finishRewards: { items: [] },
        objectives: [
          { id: OBJ.visit, type: 'visit', description: 'Locate the UN checkpoint on Customs', maps: [CUSTOMS],
            zones: [{ id: 'un_checkpoint', map: CUSTOMS, position: { x: -142.6, y: 0.6, z: 92.1 }, top: 6.5, bottom: -2 }] },
          { id: OBJ.shoot, type: 'shoot', description: 'Eliminate Scavs while wearing a UN uniform', count: 30, maps: [] },
          { id: OBJ.give, type: 'giveItem', description: 'Hand over found in raid Military flash drives', count: 2, foundInRaid: true, items: [], maps: [] },
        ],
      },
    },
  },
  tasks_ru: {
    'Peacekeeping Mission': 'Миротворческая миссия',
    'Locate the UN checkpoint on Customs': 'Найти блокпост ООН на Таможне',
    'Eliminate Scavs while wearing a UN uniform': 'Убить Диких в форме ООН',
    'Hand over found in raid Military flash drives': 'Передать найденные в рейде военные флешки',
  },
  traders: { [TRADER]: { id: TRADER, name: 'Peacekeeper', levels: [] } },
  traders_ru: { Peacekeeper: 'Миротворец' },
  maps: { maps: { [CUSTOMS]: { id: CUSTOMS, name: 'Customs', normalizedName: 'customs' } } },
  items: { items: {} },
  hideout: {},
}

function profileWithProgress() {
  const profile = createLocalProfile('Оператор', 'quest-sync-e2e')
  let pvp = profile.modes.pvp
  const before = pvp.taskProgress
  pvp = { ...pvp, taskProgress: { [TASK]: { taskId: TASK, status: 'active', source: 'eft-log', updatedAt: '2026-09-30T08:00:00.000Z' } } }
  pvp = appendEvents(pvp, taskStatusEvents(before, pvp.taskProgress, 'pvp', '2026-09-30T08:00:00.000Z'))
  const change = (objectiveId: string, type: string, target: number, current: number, source: ObjectiveProgress['source'], observedAt: string) => {
    pvp = applyObjectiveChange(pvp, 'pvp', { objectiveId, taskId: TASK, type, target, current, source, confidence: source === 'manual' ? 1 : 0.7, observedAt }).progress
  }
  change(OBJ.shoot, 'shoot', 30, 8, 'ocr', '2026-09-30T09:10:00.000Z')
  change(OBJ.visit, 'visit', 1, 1, 'manual', '2026-09-30T09:20:00.000Z')
  change(OBJ.give, 'giveItem', 2, 1, 'manual', '2026-09-30T09:40:00.000Z')
  change(OBJ.shoot, 'shoot', 30, 12, 'ocr', '2026-09-30T10:05:00.000Z')
  return { ...profile, modes: { ...profile.modes, pvp } }
}

async function openQuest(page: Page) {
  await page.route((url) => url.hostname !== '127.0.0.1' && url.hostname !== 'localhost', (route) => {
    const url = new URL(route.request().url())
    const endpoint = url.hostname === 'json.tarkov.dev' ? url.pathname.split('/').pop() ?? '' : ''
    if (endpoint in catalog) return route.fulfill({ json: { data: catalog[endpoint] } })
    if (/_(ru|en)$/.test(endpoint)) return route.fulfill({ json: { data: {} } })
    return route.abort()
  })
  const profile = profileWithProgress()
  await page.addInitScript((saved) => {
    if (sessionStorage.getItem('quest-sync-e2e')) return
    sessionStorage.setItem('quest-sync-e2e', '1')
    localStorage.setItem('tarkov-operations-profiles-v2', JSON.stringify({ activeProfileId: saved.id, profiles: [saved] }))
    localStorage.setItem('tarkov-operations-locale-v1', 'ru')
  }, profile)
  await page.setViewportSize({ width: 1440, height: 2000 })
  await page.goto(`/#/quests?filter=all&selected=${TASK}`)
  await expect(page.locator('.quest-detail h2')).toHaveText('Миротворческая миссия', { timeout: 30_000 })
}

test('quest detail shows objective counters, history and undo (RU and EN)', async ({ page }, testInfo) => {
  // Two catalog loads (RU, then the English overlay) from the fixture.
  test.setTimeout(120_000)
  await openQuest(page)
  const detail = page.locator('.quest-detail')
  await expect(detail.getByText('12/30')).toBeVisible()
  await expect(detail.getByText('1/2')).toBeVisible()
  await expect(detail.getByText('История изменений')).toBeVisible()
  await expect(detail.getByRole('checkbox', { name: /Найти блокпост ООН/ })).toBeChecked()
  const shot = async (name: string) => {
    const path = testInfo.outputPath(name)
    await detail.screenshot({ path })
    if (process.env.QUEST_SCREENSHOT_DIR) await detail.screenshot({ path: `${process.env.QUEST_SCREENSHOT_DIR}/${name}` })
  }
  await shot('quest-objectives-ru.png')

  // Counter edits are manual; the newest OCR reading can be undone.
  await detail.getByRole('button', { name: 'Больше' }).nth(1).click()
  await expect(detail.getByText('2/2')).toBeVisible()
  await detail.getByRole('button', { name: /Отменить/ }).first().click()
  await expect(detail.getByText('8/30')).toBeVisible()
  await expect(detail.getByText(/отменено/)).toBeVisible()

  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(detail.getByText('Change history')).toBeVisible()
  await expect(detail.getByText('8/30')).toBeVisible()
  await shot('quest-objectives-en.png')
  await page.getByRole('button', { name: 'RU', exact: true }).click()
  await expect(detail.getByText('История изменений')).toBeVisible()
  await expect(detail.getByText('8/30')).toBeVisible()
})
