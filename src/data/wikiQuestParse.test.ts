import { describe, expect, it } from 'vitest'
import { mergeStoryChapters, mergeWikiQuestDetails, parseStoryIndex, parseWikiQuestPage, storyQuestFromPage } from './wikiQuestParse'
import { questAppliesToMap } from '../progression/questLocation'

const tourWiki = `{{Infobox quest
|location     = [[Эпицентр|Эпицентр (Обучение)]]
|given by     =
|previous     =
|leads to     = [[Небеса в огне]]
}}

'''Тур''' - глава сюжетной истории в Escape from Tarkov.

== Диалог ==
{{Quote|Эвакуироваться придётся самостоятельно. Но в первую очередь мне нужно выбраться из эпицентра событий.}}

== Цель(и) ==
* Выбраться из [[Эпицентр]]а
* Поговорить с [[Терапевт]]ом
** (опционально) Собрать сумму в 250 000 руб.
* Связаться с гарнизоном порта через интерком

== Выполнение ==
=== Побег с Эпицентра ===
Завершите обучающий рейд, выйдя через точку выхода.

=== Терминал ===
Отправьтесь в юго-восточный угол [[Берег]]а и взаимодействуйте с интеркомом у сторожевой вышки перед Терминалом.

== Награды ==
* Разблокирует [[Лаборатория|Лабораторию]]
`

const indexWiki = `{| class="wikitable"
!Глава
!Глава EN
|-
|[[Тур]]
|Tour
|-
|[[Небеса в огне]]
|Falling Skies
|}`

describe('wiki quest parse', () => {
  it('reads story chapter objectives, maps and execution stages', () => {
    const page = parseWikiQuestPage('Тур', tourWiki)
    expect(page.description).toMatch(/эвакуироваться/i)
    expect(page.locationMaps).toEqual(expect.arrayContaining(['ground-zero', 'shoreline']))
    expect(page.objectives[0]).toMatch(/эпицентр/i)
    expect(page.stages[0]?.title).toBe('Побег с Эпицентра')
    expect(page.stages[1]?.title).toBe('Терминал')
    expect(page.stages[1]?.mapIds).toContain('shoreline')
    expect(page.stages[1]?.landmarkHints?.some((hint) => /интерком|терминал|вышк/i.test(hint))).toBe(true)
    expect(page.nextTitles).toContain('Небеса в огне')
  })

  it('parses the story chapter index', () => {
    expect(parseStoryIndex(indexWiki).map((row) => row.title)).toEqual(['Тур', 'Небеса в огне'])
    expect(parseStoryIndex(indexWiki)[0]?.english).toBe('Tour')
  })

  it('adds story chapters without inventing ordinary wiki stubs', () => {
    const tour = storyQuestFromPage(parseWikiQuestPage('Тур', tourWiki), 1, 'Tour')
    const merged = mergeStoryChapters([
      { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: 'Задание от торговца Прапор.', objectives: [], rewards: [] },
    ], [tour])
    expect(merged.find((quest) => quest.id === 'debut')).toBeTruthy()
    expect(merged.find((quest) => quest.kind === 'story')?.id).toBe('story-tour')
    expect(merged.find((quest) => quest.name === 'Ищейка')).toBeUndefined()
  })

  it('overlays wiki text onto existing trader quests', () => {
    const page = parseWikiQuestPage('Дебют', `{{Infobox quest
|location = [[Таможня]]
|previous = 
|leads to = [[Проверка]]
}}
== Диалог ==
{{Quote|Уничтожь диких на таможне и принеси ружья.}}
== Цель(и) ==
* Уничтожить 5 Диких
`)
    const merged = mergeWikiQuestDetails([
      { id: 'debut', name: 'Дебют', trader: 'Прапор', level: 1, kappa: true, description: 'Задание от торговца Прапор.', objectives: ['5a03153686f77442d90e2171'], rewards: [] },
    ], [page])
    expect(merged[0]?.description).toMatch(/диких/i)
    expect(merged[0]?.objectives[0]).toMatch(/уничтожить/i)
    expect(merged[0]?.mapIds).toContain('customs')
  })

  it('never adds wiki maps to a quest whose objectives already name its maps', () => {
    const page = parseWikiQuestPage('Осведомлён значит вооружён', `{{Infobox quest
|location = [[Таможня]], [[Лес]], [[Развязка]]
}}
== Цель(и) ==
* Установить WI-FI Камеру для наблюдения за причалом лесопилки на локации Лес
* Установить WI-FI Камеру для наблюдения за магазином Kiba Arms на локации Развязка
== Прохождение ==
Камеру можно найти на Таможне.
`)
    const merged = mergeWikiQuestDetails([
      { id: 'ima', name: 'Осведомлён значит вооружён', trader: 'Механик', level: 1, kappa: true, description: '', objectives: [], rewards: [], mapId: undefined, mapIds: ['woods', 'interchange'] },
    ], [page])
    expect(merged[0]?.mapIds).toEqual(['woods', 'interchange'])
    expect(questAppliesToMap(merged[0]!, 'customs')).toBe(false)
    expect(questAppliesToMap(merged[0]!, 'woods')).toBe(true)
    expect(questAppliesToMap(merged[0]!, 'interchange')).toBe(true)
  })

  it('takes wiki maps only from the infobox location, not from walkthrough text', () => {
    const page = parseWikiQuestPage('Поставщик', `{{Infobox quest
|location = [[Берег]]
}}
== Прохождение ==
Нужный предмет чаще встречается на Таможне.
`)
    const merged = mergeWikiQuestDetails([
      { id: 'supplier', name: 'Поставщик', trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [] },
    ], [page])
    expect(merged[0]?.mapIds).toEqual(['shoreline'])
  })
})
