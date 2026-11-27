import { describe, expect, it } from 'vitest'
import { looksLikeScanner, siteHostAllowed, siteRoute } from './siteProxy'

// Security review, 27.11.2026: DNS rebinding — the site on this PC answers only its own names and the public link's.
describe('the Host the site on this PC answers', () => {
  it('this PC\'s own names with the site\'s port', () => {
    expect(siteHostAllowed('127.0.0.1:5202', 5202)).toBe(true)
    expect(siteHostAllowed('localhost:5202', 5202)).toBe(true)
    expect(siteHostAllowed('LocalHost:5202', 5202)).toBe(true)
    for (const host of ['127.0.0.1', 'localhost', 'localhost:80', '127.0.0.1:8787', '127.0.0.1:52020', 'rebind.evil.example:5202', 'localhost.evil.example:5202', '', undefined]) {
      expect(siteHostAllowed(host, 5202), String(host)).toBe(false)
    }
  })

  it('the public link\'s names while it is on (cloudflared passes the visitor\'s Host on), nothing like them', () => {
    const tunnel = ['tarkov.example.com', 'www.tarkov.example.com', 'quiet-river-1234.trycloudflare.com']
    expect(siteHostAllowed('tarkov.example.com', 5202, tunnel)).toBe(true)
    expect(siteHostAllowed('TARKOV.example.com:443', 5202, tunnel)).toBe(true)
    expect(siteHostAllowed('quiet-river-1234.trycloudflare.com', 5202, tunnel)).toBe(true)
    for (const host of ['other-name.trycloudflare.com', 'tarkov.example.com.evil.example', 'evil-tarkov.example.com', 'tarkov.example.com:8080', '']) {
      expect(siteHostAllowed(host, 5202, tunnel), host).toBe(false)
    }
    expect(siteHostAllowed('tarkov.example.com', 5202, [])).toBe(false)
  })
})

describe('site → API for scanner paths («Страж сервера»)', () => {
  it('sends what only scanners ask for to the API guard', () => {
    for (const path of ['/.env', '/.git/config', '/wp-login.php', '/wp-admin/', '/phpmyadmin/', '/cgi-bin/luci', '/index.php', '/config.yml', '/backup.sql', '/.aws/credentials', '/vendor/phpunit/phpunit/x'])
      expect(siteRoute(path), path).toBe('api')
  })

  it('keeps every real site page and file on the site', () => {
    const pages = ['/', '/about', '/download', '/login', '/app-login', '/register', '/reset', '/cabinet', '/admin', '/legal', '/legal/offer', '/r/STREAMER', '/streamer/abcDEF_123-xyz', '/no-such-page',
      '/favicon.svg', '/brand/logo.svg', '/media/trailer.mp4', '/assets/index-Bx12_aZ.js', '/assets/index-9f8e7d.css', '/download/version.json', '/.well-known/security.txt']
    for (const path of pages) {
      expect(looksLikeScanner(path), path).toBe(false)
      expect(siteRoute(path), path).toBe('site')
    }
    expect(siteRoute('/v1/accounts/me')).toBe('api')
    expect(siteRoute('/v1/admin/accounts')).toBe('blocked')
  })
})
