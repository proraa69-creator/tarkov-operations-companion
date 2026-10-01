// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SITE_CSP, siteSecurityHeaders } from './siteHeaders'

const directives = (csp: string) => new Map(csp.split(';').map((part) => part.trim().split(/\s+/)).map(([name, ...values]) => [name!, values]))

describe('website security headers', () => {
  it('sends the full set', () => {
    expect(siteSecurityHeaders()).toEqual({
      'Content-Security-Policy': SITE_CSP,
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })
  })

  it('CSP: only the site itself plus Cloudflare Web Analytics; no inline or eval scripts, no frames, no plugins', () => {
    const csp = directives(SITE_CSP)
    expect(csp.get('default-src')).toEqual(["'self'"])
    expect(csp.get('script-src')).toEqual(["'self'", 'https://static.cloudflareinsights.com'])
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://cloudflareinsights.com'])
    expect(csp.get('img-src')).toEqual(["'self'", 'data:', 'blob:'])
    expect(csp.get('style-src')).toEqual(["'self'", "'unsafe-inline'"])
    expect(csp.get('frame-src')).toEqual(["'none'"])
    expect(csp.get('frame-ancestors')).toEqual(["'none'"])
    expect(csp.get('base-uri')).toEqual(["'self'"])
    expect(csp.get('form-action')).toEqual(["'self'"])
    expect(csp.get('object-src')).toEqual(["'none'"])
    expect(SITE_CSP).not.toMatch(/unsafe-eval|\*/)
    expect(csp.get('script-src')).not.toContain("'unsafe-inline'")
  })
})
