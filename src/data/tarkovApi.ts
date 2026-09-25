import type { AppDataset, Item, Quest } from '../domain/types'
import { demoDataset } from './demo'

const ENDPOINT = 'https://api.tarkov.dev/graphql'
const QUERY = `
  query CompanionData {
    tasks(lang: ru) {
      id
      name
      minPlayerLevel
      kappaRequired
      trader { name }
      map { normalizedName }
      objectives { description }
    }
    items(lang: ru) {
      id
      name
      shortName
      iconLink
      avg24hPrice
      basePrice
      types
      sellFor { price source }
    }
  }
`

interface ApiTask {
  id: string
  name: string
  minPlayerLevel?: number
  kappaRequired?: boolean
  trader?: { name?: string }
  map?: { normalizedName?: string }
  objectives?: Array<{ description?: string }>
}

interface ApiItem {
  id: string
  name: string
  shortName?: string
  iconLink?: string
  avg24hPrice?: number
  basePrice?: number
  types?: string[]
  sellFor?: Array<{ price?: number; source?: string }>
}

interface ApiResponse {
  data?: { tasks?: ApiTask[]; items?: ApiItem[] }
  errors?: Array<{ message: string }>
}

export async function fetchTarkovData(): Promise<AppDataset> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 9000)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: QUERY }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Tarkov.dev: ${response.status}`)
    const payload = await response.json() as ApiResponse
    if (payload.errors?.length || !payload.data) throw new Error(payload.errors?.[0]?.message ?? 'Пустой ответ API')

    const liveQuests = (payload.data.tasks ?? []).map(adaptQuest)
    const liveItems = (payload.data.items ?? []).map(adaptItem)
    return {
      ...demoDataset,
      quests: liveQuests.length ? liveQuests : demoDataset.quests,
      items: mergeItems(liveItems, demoDataset.items),
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

function adaptQuest(task: ApiTask): Quest {
  return {
    id: task.id,
    name: task.name,
    trader: task.trader?.name ?? 'Неизвестно',
    mapId: task.map?.normalizedName,
    level: task.minPlayerLevel ?? 1,
    kappa: Boolean(task.kappaRequired),
    description: 'Актуальные данные задания загружены из Tarkov.dev.',
    objectives: task.objectives?.map((objective) => objective.description).filter(Boolean) as string[] || [],
    rewards: ['Откройте официальную Wiki для полного списка наград'],
  }
}

function adaptItem(item: ApiItem): Item {
  const category = mapCategory(item.types ?? [])
  const sellFor = item.sellFor?.filter((quote) => quote.price).slice(0, 3) ?? []
  return {
    id: item.id,
    name: item.name,
    shortName: item.shortName ?? item.name,
    category,
    description: 'Актуальная карточка предмета из Tarkov.dev.',
    iconUrl: item.iconLink,
    prices: sellFor.length
      ? sellFor.map((quote) => ({ source: quote.source ?? 'Торговец', price: quote.price ?? 0, mode: 'pvp' as const, updatedAt: new Date().toISOString() }))
      : [{ source: 'Базовая цена', price: item.avg24hPrice ?? item.basePrice ?? 0, mode: 'pvp', updatedAt: new Date().toISOString() }],
  }
}

function mapCategory(types: string[]): Item['category'] {
  if (types.includes('keys')) return 'Ключ'
  if (types.includes('ammo')) return 'Боеприпас'
  if (types.includes('gun')) return 'Оружие'
  if (types.includes('armor')) return 'Броня'
  if (types.includes('meds')) return 'Медицина'
  if (types.includes('food') || types.includes('drink')) return 'Еда'
  return 'Бартер'
}

function mergeItems(live: Item[], local: Item[]) {
  const localById = new Map(local.map((item) => [item.id, item]))
  return live.map((item) => localById.has(item.id) ? { ...item, ...localById.get(item.id), prices: item.prices } : item)
}
