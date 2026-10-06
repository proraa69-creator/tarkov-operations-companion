import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { desktopContentSecurityPolicy, installDesktopContentSecurityPolicy, isPackagedDesktopPage } from './contentSecurityPolicy'

const directive = (policy: string, name: string) => policy.split('; ').find((entry) => entry.startsWith(`${name} `)) ?? ''

describe('desktop Content-Security-Policy (M2)', () => {
  afterEach(() => document.head.querySelectorAll('meta[data-raidos-csp]').forEach((meta) => meta.remove()))

  it('scripts only from the app; no plugins, no <base>, no form posts', () => {
    const policy = desktopContentSecurityPolicy()
    expect(directive(policy, 'script-src')).toBe("script-src 'self'")
    expect(policy).not.toContain('unsafe-eval')
    expect(directive(policy, 'script-src')).not.toContain('unsafe-inline')
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("base-uri 'none'")
    expect(policy).toContain("form-action 'none'")
  })

  it('network only to the hosts the renderer uses (+ build-time service addresses)', () => {
    const connect = directive(desktopContentSecurityPolicy(['https://api.example.com/v1', 'javascript:alert(1)', undefined, '']), 'connect-src')
    expect(connect).toBe("connect-src 'self' data: blob: https://api.tarkov.dev https://json.tarkov.dev https://assets.tarkov.dev https://raw.githubusercontent.com https://escapefromtarkov.fandom.com https://api.example.com")
    expect(connect).not.toMatch(/ https: | \*/)
  })

  it('is added only to the packaged desktop page (file://), before the app runs, once', () => {
    const desktop = { location: { protocol: 'file:' } as Location, tarkovDesktop: { isDesktop: true } }
    expect(isPackagedDesktopPage({ location: { protocol: 'http:' } as Location, tarkovDesktop: { isDesktop: true } })).toBe(false)
    expect(isPackagedDesktopPage({ location: { protocol: 'file:' } as Location })).toBe(false)
    expect(installDesktopContentSecurityPolicy(document, desktop)).toBe(true)
    expect(installDesktopContentSecurityPolicy(document, desktop)).toBe(false)
    const meta = document.head.querySelector<HTMLMetaElement>('meta[data-raidos-csp]')!
    expect(meta.httpEquiv).toBe('Content-Security-Policy')
    expect(document.head.firstElementChild).toBe(meta)
  })

  it('src/main.tsx imports it before anything else; index.html keeps the common part', () => {
    const main = readFileSync(join(__dirname, '..', 'main.tsx'), 'utf8')
    expect(main.split('\n').find((line) => line.startsWith('import '))).toBe("import './app/contentSecurityPolicy'")
    const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8')
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'none'" />`)
  })
})
