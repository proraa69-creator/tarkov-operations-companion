// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pageHtml } from './prerender-website.mjs'

const template = '<html><head><meta name="description" content="old" /><meta property="og:url" content="https://raidos.app/" /><title>Old</title></head><body><div id="root"></div></body></html>'

describe('prerendered pages', () => {
  it('puts the rendered page into #root with its own title, description and canonical address', () => {
    const html = pageHtml(template, '/download', '<main>Скачать приложение</main>', { title: 'Скачать Raid OS', description: 'Портативная версия "для" Windows' })
    expect(html).toContain('<div id="root"><main>Скачать приложение</main></div>')
    expect(html).toContain('<title>Скачать Raid OS</title>')
    expect(html).toContain('<meta name="description" content="Портативная версия &quot;для&quot; Windows" />')
    expect(html).toContain('<meta property="og:url" content="https://raidos.app/download" />')
    expect(html).toContain('<link rel="canonical" href="https://raidos.app/download" />')
  })

  it('refuses a template without an empty root', () => {
    expect(() => pageHtml('<div id="root">x</div>', '/', '<main/>', { title: 't', description: 'd' })).toThrow()
  })
})
