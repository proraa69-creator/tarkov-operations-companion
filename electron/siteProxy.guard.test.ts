import { describe, expect, it } from 'vitest'
import { looksLikeScanner, siteRoute } from './siteProxy'

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
