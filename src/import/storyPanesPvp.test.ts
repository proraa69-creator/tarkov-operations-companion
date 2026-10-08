import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters } from '../data/storyChapters'
import { createModeProgress } from '../domain/progress'
import type { ModeProgress } from '../domain/types'
import { storyObjectiveMapLinks, visibleStoryObjectives } from '../progression/storyObjectives'
import { PVP_BATYA, PVP_BOREAS, PVP_FALLING_SKIES, PVP_TOUR, withOcrNoise } from './__fixtures__/storyPanesPvp'
import { applyStoryScan, confirmStoryFrame, matchStoryChapters, storyPaneChapter } from './storyScan'
import { readStoryObjectives } from './storyObjectives'
import { storyStageCopies } from './storyStageOcr'

const QUESTS = addMissingStoryChapters([], 'ru')
const STORY = QUESTS.filter((quest) => quest.kind === 'story')
const chapter = (id: string) => STORY.find((quest) => quest.id === id)!

function saved(id: string, stage: number): ModeProgress {
  const progress = createModeProgress()
  progress.taskProgress[id] = { taskId: id, status: 'active', source: 'screen-scan', currentStageIndex: stage, updatedAt: '2026-10-01T00:00:00.000Z' }
  return progress
}

/** What the scanner does with two fresh readings of the same pane (read once, applied to any saved progress). */
function scanner(text: string) {
  const matches = matchStoryChapters(text, QUESTS)
  const first = confirmStoryFrame(null, 'profile:pvp', 1000, matches)
  const second = confirmStoryFrame(first.state, 'profile:pvp', 2000, matches)
  return (progress: ModeProgress) => applyStoryScan(applyStoryScan(progress, matches.filter((match) => match.objectives?.length), '2026-10-08T10:00:00.000Z'), second.confirmed, '2026-10-08T10:00:01.000Z')
}
const scanTwice = (progress: ModeProgress, text: string) => scanner(text)(progress)

const links = (id: string, progress: ModeProgress) => visibleStoryObjectives(chapter(id), progress)
  .map((objective) => [objective.text, storyObjectiveMapLinks(chapter(id), objective).map((link) => link.mapId)])

describe('story panes of the owner\'s PvP account (real in-game wording)', () => {
  for (const [variant, prepare] of [['clean', (text: string) => text], ['OCR noise', withOcrNoise]] as const) {
    it(`«Тур» (${variant}): the second «Поговорить с Лыжником» (stage 12), optional «Посетить Лес 1/3» on Woods`, () => {
      const next = scanTwice(createModeProgress(), prepare(PVP_TOUR))
      expect(next.taskProgress['story-tour']).toMatchObject({ status: 'active', currentStageIndex: 12 })
      expect(visibleStoryObjectives(chapter('story-tour'), next)).toMatchObject([
        { text: 'Поговорить с Лыжником', optional: false, stageIndex: 12 },
        { text: 'Посетить Лес', optional: true, current: 1, total: 3, stageIndex: 14 },
      ])
      expect(links('story-tour', next)).toEqual([['Поговорить с Лыжником', []], ['Посетить Лес', ['woods']]])
    })

    it(`«Небеса в огне» (${variant}): «Разузнать у торговцев про упавший самолет» is stage 0`, () => {
      const next = scanTwice(createModeProgress(), prepare(PVP_FALLING_SKIES))
      expect(next.taskProgress['story-falling-skies']).toMatchObject({ status: 'active', currentStageIndex: 0 })
      expect(visibleStoryObjectives(chapter('story-falling-skies'), next)).toMatchObject([{ text: 'Разузнать у торговцев про упавший самолет', stageIndex: 0 }])
    })

    it(`«Батя» (${variant}): stage 1 and the four optional finds at the stages that have their points`, () => {
      const next = scanTwice(createModeProgress(), prepare(PVP_BATYA))
      expect(next.taskProgress['story-batya']).toMatchObject({ status: 'active', currentStageIndex: 1 })
      expect(links('story-batya', next)).toEqual([
        ['Узнать у торговцев больше о Богатырях', []],
        ['Найти личные вещи командира отряда', ['interchange']],
        ['Найти памятный предмет одного из Богатырей', ['woods']],
        ['Найти личный предмет Богатырей', ['interchange']],
        ['Найти жетон одного из Богатырей', []],
      ])
    })

    it(`«Борей» (${variant}): both objectives at the cellular tower on Woods, hints kept apart from the titles`, () => {
      const next = scanTwice(createModeProgress(), prepare(PVP_BOREAS))
      expect(next.taskProgress['story-boreas']).toMatchObject({ status: 'active', currentStageIndex: 2 })
      expect(visibleStoryObjectives(chapter('story-boreas'), next)).toMatchObject([
        { text: 'Починить оборудование под вышкой сотовой связи на локации Лес', stageIndex: 3, hint: 'Для ремонта понадобится набор инструментов' },
        { text: 'Найти оборудование под вышкой сотовой связи на локации Лес', stageIndex: 2, hint: 'Вышка находится в северо-западной части заповедника, рядом с бункером Диких' },
      ])
      expect(links('story-boreas', next).map(([, maps]) => maps)).toEqual([['woods'], ['woods']])
      expect(chapter('story-boreas').stages![2]!.points?.length).toBeGreaterThan(0)
    })
  }

  it('reads the open chapter from the pane header, not from words of the description', () => {
    expect(storyPaneChapter(PVP_BATYA, STORY)).toMatchObject({ quest: { id: 'story-batya' }, active: true })
    // «Лес» / «Лыжник» in the description of another chapter never name it.
    expect(matchStoryChapters(PVP_TOUR, QUESTS).filter((match) => match.stageIndex != null || match.objectives?.length).map((match) => match.questId)).toEqual(['story-tour'])
  })

  it('never appends the stash grid, the version or the menu bar to an objective', () => {
    const objectives = readStoryObjectives(PVP_TOUR, chapter('story-tour'))
    expect(objectives.map((objective) => objective.text)).toEqual(['Поговорить с Лыжником', 'Посетить Лес'])
    expect(objectives.every((objective) => !objective.hint)).toBe(true)
  })

  it('shows an active chapter whose wording the catalog does not know yet, without touching its stage', () => {
    const text = PVP_FALLING_SKIES.replace('Разузнать у торговцев про упавший самолет', 'Выведать у торговцев правду о пилотах')
    const progress = saved('story-falling-skies', 4)
    const next = scanTwice(progress, text)
    expect(next.taskProgress['story-falling-skies']).toMatchObject({ status: 'active', currentStageIndex: 4 })
    expect(visibleStoryObjectives(chapter('story-falling-skies'), next)).toMatchObject([{ text: 'Выведать у торговцев правду о пилотах' }])
    expect(visibleStoryObjectives(chapter('story-falling-skies'), next)[0]!.stageIndex).toBeUndefined()
  })

  it('confirms a stage over two frames even when the grey hint is read differently', () => {
    const one = matchStoryChapters(PVP_BOREAS, QUESTS)
    const two = matchStoryChapters(PVP_BOREAS.replace('набор инструментов', 'набор инструментоз'), QUESTS)
    const first = confirmStoryFrame(null, 'p:pvp', 1, one)
    expect(confirmStoryFrame(first.state, 'p:pvp', 2, two).confirmed.map((match) => match.questId)).toEqual(['story-boreas'])
  })

  it('corrects a stale higher stage left by the old forward jumps («Батя» 10 instead of 1), never keeps it', () => {
    const panes = [['story-batya', PVP_BATYA, 1], ['story-falling-skies', PVP_FALLING_SKIES, 0], ['story-boreas', PVP_BOREAS, 2], ['story-tour', PVP_TOUR, 12]] as const
    for (const [id, text, shown] of panes) {
      const scan = scanner(text)
      for (let stage = shown + 1; stage < chapter(id).stages!.length; stage += 1) {
        expect(scan(saved(id, stage)).taskProgress[id]!.currentStageIndex, `${id}: saved ${stage}`).toBe(shown)
      }
    }
  })
})

describe('repeated and nested stage titles never move a chapter backwards', () => {
  const pane = (id: string, main: string, optional = '') => `ЗАДАНИЯ\nСЮЖЕТНЫЕ ПОБОЧНЫЕ\nИСТОРИЯ\n${chapter(id).name}\nАКТИВНО\nГлавные задачи\n${main}\n${optional ? `Опциональные задачи\n${optional}\n` : ''}Награды`
  const cases: Array<[string, number, string, number]> = [
    ['story-tour', 12, 'Поговорить с Лыжником', 12],
    ['story-tour', 11, 'Поговорить с Лыжником', 12],
    ['story-the-unheard', 28, 'Узнать больше о Неизвестных', 28],
    ['story-boreas', 69, 'Вернуться к Водителю БТР', 69],
    ['story-boreas', 45, 'Добраться до машинного отделения', 45],
    ['story-the-ticket', 84, 'Спросить у торговцев, как выбраться из Таркова', 84],
    ['story-the-ticket', 66, 'Построить Солнечную электростанцию 1-го уровня', 66],
    ['story-the-ticket', 20, 'Открыть бронированный кейс с помощью глушителя сигнала', 20],
    ['story-they-are-already-here', 2, 'Узнать больше о жертве культистов из пыточной', 2],
  ]
  for (const [id, stage, main, expected] of cases) {
    it(`${chapter(id).name}: saved ${stage}, pane «${main}» → ${expected}`, () => {
      expect(scanTwice(saved(id, stage), pane(id, main)).taskProgress[id]!.currentStageIndex).toBe(expected)
    })
  }

  it('a repeated title on the first reading follows the optional objectives, otherwise stays unknown', () => {
    expect(scanTwice(createModeProgress(), pane('story-tour', 'Поговорить с Лыжником', 'Посетить Таможню 0/3')).taskProgress['story-tour']!.currentStageIndex).toBe(6)
    const unknown = scanTwice(createModeProgress(), pane('story-boreas', 'Вернуться к Водителю БТР')).taskProgress['story-boreas']!
    expect(unknown.status).toBe('active')
    expect(unknown.currentStageIndex).toBeUndefined()
  })

  it('an objective repeated later in the chapter links to the copy of the stage being played', () => {
    const next = scanTwice(saved('story-boreas', 45), pane('story-boreas', 'Добраться до машинного отделения'))
    expect(visibleStoryObjectives(chapter('story-boreas'), next)[0]!.stageIndex).toBe(45)
  })
})

describe('every objective of the story catalog', () => {
  it('is read as one objective of its own stage (or a copy of it), done only with the status word', () => {
    const misses: string[] = []
    for (const quest of STORY) (quest.stages ?? []).forEach((stage, index) => {
      const open = readStoryObjectives(`Главные задачи\n${stage.title}\nНаграды`, quest)
      const done = readStoryObjectives(`Главные задачи\n${stage.title} Выполнено\nНаграды`, quest)
      const ok = open.length === 1 && !open[0]!.completed && open[0]!.stageIndex != null
        && storyStageCopies(quest, open[0]!.stageIndex!, stage.title).includes(index) && done[0]?.completed === true
      if (!ok) misses.push(`${quest.name} #${index} «${stage.title}»`)
    })
    expect(misses).toEqual([])
  })
})
