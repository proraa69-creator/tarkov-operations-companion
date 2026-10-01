import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * The API under the website's own address (electron/localServer.ts): /health and /v1/* on 127.0.0.1:5202 go to the
 * API on 127.0.0.1:<apiPort>, so the site keeps working when opened through the public link. Kept free of Electron
 * imports so the whole path (site → proxy → real API, e.g. QR sign-in) is tested in siteProxy.test.ts.
 */
export function proxyToApi(request: IncomingMessage, response: ServerResponse, apiPort: number) {
  const upstream = httpRequest({ host: '127.0.0.1', port: apiPort, method: request.method, path: request.url, headers: { ...request.headers, host: `127.0.0.1:${apiPort}` } }, (answer) => {
    response.writeHead(answer.statusCode ?? 502, answer.headers)
    answer.pipe(response)
  })
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Сервер аккаунтов не запущен (HTTP 502). Владельцу: проверьте лампы в приложении-сервере.' }))
  })
  request.pipe(upstream)
}

/** Whether a site path belongs to the API (the owner's admin API never goes through the site). */
export function siteRoute(path: string): 'blocked' | 'api' | 'site' {
  if (/^\/+v1\/+admin(\/|$)/i.test(path.replace(/\\/g, '/'))) return 'blocked'
  if (path === '/health' || path.startsWith('/v1/')) return 'api'
  return 'site'
}
