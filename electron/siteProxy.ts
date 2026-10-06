import { request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'

/**
 * The visitor's address for the API's per-IP rate limits (it trusts X-Forwarded-For from loopback only). The public
 * link arrives through cloudflared on 127.0.0.1, so the socket address is the same for everybody; Cloudflare's edge
 * sets CF-Connecting-IP itself (a visitor cannot choose it), and a header a visitor sent is never passed on as is.
 */
export function visitorAddress(socketAddress: string | undefined, headers: IncomingMessage['headers']) {
  const loopback = !socketAddress || socketAddress === '127.0.0.1' || socketAddress === '::1' || socketAddress === '::ffff:127.0.0.1'
  const cf = typeof headers['cf-connecting-ip'] === 'string' ? headers['cf-connecting-ip'].trim() : ''
  if (loopback && /^[0-9a-fA-F.:]{2,45}$/.test(cf)) return cf
  return socketAddress ?? '127.0.0.1'
}

/**
 * The API under the website's own address (electron/localServer.ts): /health and /v1/* on 127.0.0.1:5202 go to the
 * API on 127.0.0.1:<apiPort>, so the site keeps working when opened through the public link. Kept free of Electron
 * imports so the whole path (site → proxy → real API, e.g. QR sign-in) is tested in siteProxy.test.ts.
 */
export function proxyToApi(request: IncomingMessage, response: ServerResponse, apiPort: number, decidedPath?: string) {
  const target = forwardedPath(request.url, decidedPath)
  if (!target || siteRoute(target.path) !== 'api') {
    request.resume()
    response.writeHead(target ? 404 : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    response.end(JSON.stringify({ error: target ? 'Не найдено' : 'Некорректный адрес' }))
    return
  }
  // Everything else (Sec-Fetch-Site / -Mode / -Dest included: the API's guard does not score what another site's page
  // made a visitor's browser load) goes on as the browser sent it.
  const { 'x-forwarded-for': _forwarded, ...headers } = request.headers
  void _forwarded
  const forwardedFor = visitorAddress(request.socket.remoteAddress, request.headers)
  const upstream = httpRequest({ host: '127.0.0.1', port: apiPort, method: request.method, path: target.url, headers: { ...headers, host: `127.0.0.1:${apiPort}`, 'x-forwarded-for': forwardedFor } }, (answer) => {
    response.writeHead(answer.statusCode ?? 502, answer.headers)
    answer.pipe(response)
  })
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Сервер аккаунтов не запущен (HTTP 502). Владельцу: проверьте лампы в приложении-сервере.' }))
  })
  request.pipe(upstream)
}

/**
 * The path the site server decided on (localServer.ts: `decodeURIComponent(new URL(url).pathname)`, passed in as
 * `decidedPath` or computed the same way here) and the URL that goes to the API: exactly that path, each segment
 * encoded again, plus the original query. The API therefore never sees a different path than the one siteRoute()
 * allowed (no %2F / %2e tricks around the /v1/admin block). Undefined for an undecodable path.
 */
export function forwardedPath(rawUrl: string | undefined, decidedPath?: string): { path: string; url: string } | undefined {
  let parsed: URL
  try { parsed = new URL(rawUrl ?? '/', 'http://site.invalid') } catch { return undefined }
  let path = decidedPath
  if (path === undefined) {
    try { path = decodeURIComponent(parsed.pathname) } catch { return undefined }
  }
  if (!path.startsWith('/')) return undefined
  const encoded = path.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  return { path, url: encoded + parsed.search }
}

/**
 * What only vulnerability scanners ask the website for (/.env, /.git/…, *.php, /wp-admin, /cgi-bin…). Such requests go
 * to the API, whose «Страж сервера» (server/src/services/securityGuard.ts) scores them and bans the address, and answers
 * 404 — instead of the site quietly serving index.html. The site has no such files and no page with such a path.
 */
const SCANNER_HINT = /(?:^|\/)\.(?!well-known(?:\/|$))|\.(?:php\d?|phtml|asp|aspx|jsp|cgi|env|ini|bak|sql|sqlite|yml|yaml|conf)(?:\/|$)|(?:^|\/)(?:wp-admin|wp-login|wp-content|wp-includes|xmlrpc|phpmyadmin|pma|myadmin|adminer|cgi-bin|boaform|hnap1|actuator|server-status|vendor\/phpunit)(?:\/|$|\.)/i
export const looksLikeScanner = (path: string) => SCANNER_HINT.test(path)

/** Whether a site path belongs to the API (the owner's admin API never goes through the site). */
export function siteRoute(path: string): 'blocked' | 'api' | 'site' {
  if (/^\/+v1\/+admin(\/|$)/i.test(path.replace(/\\/g, '/'))) return 'blocked'
  if (path === '/health' || path.startsWith('/v1/')) return 'api'
  if (looksLikeScanner(path)) return 'api'
  return 'site'
}
