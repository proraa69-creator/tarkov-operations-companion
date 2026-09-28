import { writeFileSync } from 'node:fs'

const get = async (url) => (await (await fetch(url)).json()).data
const [base, ru, traders, tradersRu] = await Promise.all([
  get('https://json.tarkov.dev/regular/tasks'),
  get('https://json.tarkov.dev/regular/tasks_ru'),
  get('https://json.tarkov.dev/regular/traders'),
  get('https://json.tarkov.dev/regular/traders_ru'),
])
const t = (value, dict) => (typeof value === 'string' && typeof dict[value] === 'string' ? dict[value] : value)
const traderName = new Map(Object.values(traders).map((trader) => [trader.id, t(trader.name, tradersRu)]))
const quests = Object.values(base.tasks).map((task) => ({
  id: task.id,
  name: t(task.name, ru),
  normalizedName: task.normalizedName,
  trader: traderName.get(task.trader) ?? task.trader,
  level: task.minPlayerLevel ?? 1,
  kappa: Boolean(task.kappaRequired),
  description: '',
  objectives: [],
  rewards: [],
  requirements: (task.taskRequirements ?? []).map((requirement) => ({
    taskId: requirement.task,
    allowedStatuses: (requirement.status ?? ['complete']).map((status) => (status === 'completed' ? 'complete' : status)),
  })),
}))
writeFileSync(new URL('./tasks-ru.json', import.meta.url), JSON.stringify(quests))
console.log(quests.length, quests.filter((quest) => /снабж|коням|водолей|очеред|следопыт|топливн|модный|потеря/i.test(quest.name)).map((quest) => quest.name).join(' | '))
