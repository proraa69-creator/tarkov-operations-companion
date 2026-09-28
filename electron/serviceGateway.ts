const baseUrl = process.env.TARKOV_API_URL?.replace(/\/$/, '')

export async function serviceRequest(method: string, path: string, body?: unknown): Promise<unknown | null> {
  if (!baseUrl) return null
  if (!['GET', 'POST'].includes(method) || !/^\/v1\/(?:catalog\/(?:pvp|pve|seasonal)|players\/(?:resolve|(?:pvp|pve|seasonal)\/\d+)|sync\/events)$/.test(path)) throw new Error('Неизвестный запрос сервиса')
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Для сервера требуется HTTPS')
  const token = process.env.TARKOV_API_TOKEN
  const response = await fetch(`${baseUrl}${path}`, {
    method, signal: AbortSignal.timeout(45_000),
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json() as { error?: string }
  if (!response.ok) throw new Error(result.error ?? `Сервис недоступен: ${response.status}`)
  return result
}
