/**
 * json.tarkov.dev answering from a parsed fixture shaped like tarkovDevConditionQuests.json (real regular/* data of the
 * quests with gear conditions, trimmed): `{ tasks, tasks_ru, items, items_en, … }` by endpoint name. Anything else is 404.
 */
export function conditionQuestsFetcher(fixture: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const match = /json\.tarkov\.dev\/[a-z-]+\/([a-z]+)(_[a-z]+)?$/.exec(String(input))
    if (!match) return new Response('', { status: 404 })
    return new Response(JSON.stringify({ data: fixture[`${match[1]}${match[2] ?? ''}`] ?? {} }), { status: 200 })
  }) as typeof fetch
}
