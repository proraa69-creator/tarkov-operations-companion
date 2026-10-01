/**
 * Security headers of the website server (electron/localServer.ts), sent with every answer: pages, files, downloads,
 * errors and the API through the site. Free of Electron imports, so it is unit tested (siteHeaders.test.ts) and the
 * built site can be checked in a real browser with exactly these headers.
 *
 * Content-Security-Policy — the site loads everything from itself (the API is under the same address, VITE_API_URL='/').
 * The only outside hosts are Cloudflare Web Analytics: the beacon script (static.cloudflareinsights.com, which
 * Cloudflare's edge may insert into the page) and where it reports (cloudflareinsights.com). The site embeds no frames,
 * uses no outside fonts or images, and its forms never post elsewhere: payments leave by navigation (ЮKassa / Lava.top
 * pages), which CSP does not restrict. Inline styles stay allowed (React `style` props, small layout tweaks).
 */
export const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "connect-src 'self' https://cloudflareinsights.com",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "media-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/**
 * The full header set. Referrer-Policy: strict-origin-when-cross-origin (the browsers' default, made explicit):
 * ЮKassa / Lava.top see only https://<site>/ as the referrer, which their payment pages do not need anyway; the payer
 * comes back by the return link (TARKOV_PUBLIC_URL). The site never uses the camera or other device features: a QR code
 * is scanned by the phone's own camera app.
 */
export function siteSecurityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': SITE_CSP,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  }
}
