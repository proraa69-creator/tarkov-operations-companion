// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { externalLinkPolicy, externalLinkPrompt } from './externalLinks'

describe('external links (L1)', () => {
  it('opens known sites at once', () => {
    for (const url of [
      'https://raidos.app/cabinet', 'https://www.raidos.app/', 'https://tarkov.dev/task/x', 'https://assets.tarkov.dev/a.png',
      'https://t.me/shauuuurma', 'https://t.me/other', 'https://escapefromtarkov.fandom.com/wiki/Killa',
      'https://github.com/proraa69-creator/tarkov-operations-companion/issues', 'https://github.com/proraa69-creator',
      'https://vk.com/metadvij', 'https://www.youtube.com/watch?v=1', 'https://youtu.be/1', 'https://yoomoney.ru/checkout/payments/v2/contract',
      'https://timesaver.gg/blog/tarkov-reshala-boss-guide', 'https://eft.su/b/killa/en',
      'http://localhost:5202/cabinet', 'http://127.0.0.1:5202/',
    ]) expect([url, externalLinkPolicy(url)]).toEqual([url, 'open'])
  })

  it('asks first for any other https page, look-alikes and other local addresses', () => {
    for (const url of [
      'https://evil.example/', 'https://raidos.app.evil.example/', 'https://evilraidos.app/', 'https://other.fandom.com/wiki/x',
      'https://github.com/someone-else/repo', 'https://github.com/proraa69-creatorX', 'https://vk.com/metadvijx', 'https://vk.com/somebody',
      'https://user:pass@raidos.app/', 'https://raidos.app:8443/', 'http://127.0.0.1:8787/v1/admin', 'http://localhost:9000/',
    ]) expect([url, externalLinkPolicy(url)]).toEqual([url, 'confirm'])
  })

  it('never opens other schemes or plain http on the internet', () => {
    for (const url of ['http://raidos.app/', 'file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'smb://host/share', 'not a url', ''])
      expect([url, externalLinkPolicy(url)]).toEqual([url, 'refuse'])
  })

  it('the dialog shows the host on its own line and the full address', () => {
    const prompt = externalLinkPrompt('https://evil.example/path?x=1')
    expect(prompt.detail).toContain('Сайт: evil.example')
    expect(prompt.detail).toContain('https://evil.example/path?x=1')
  })
})
