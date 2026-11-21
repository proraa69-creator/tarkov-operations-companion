import { describe, expect, it } from 'vitest'
import { fontScaleCss, scaleFontShorthand, scaleFontValue } from './fontScaleCss'
import { applyFontSize, LARGE_FONT_SCALE } from './fontSize'

const S = 'var(--font-scale, 1)'

describe('«Размер шрифта»: font sizes under one scale', () => {
  it('scales every px of a font size, its clamp too, and leaves other units', () => {
    expect(scaleFontValue('13px')).toBe(`calc(13px * ${S})`)
    expect(scaleFontValue('clamp(15px, 11cqi, 22px)')).toBe(`clamp(calc(15px * ${S}), 11cqi, calc(22px * ${S}))`)
    expect(scaleFontValue('min(24px, 4.8vw)')).toBe(`min(calc(24px * ${S}), 4.8vw)`)
    expect(scaleFontValue(`calc(13px * ${S})`)).toBe(`calc(13px * ${S})`)
  })

  it('scales the size of a font shorthand and a line height in px, not a unitless one', () => {
    expect(scaleFontShorthand('800 22px/1 var(--font-mono, Consolas, monospace)')).toBe(`800 calc(22px * ${S})/1 var(--font-mono, Consolas, monospace)`)
    expect(scaleFontShorthand('11.5px/1.6 "Cascadia Code", monospace')).toBe(`calc(11.5px * ${S})/1.6 "Cascadia Code", monospace`)
    expect(scaleFontShorthand('600 12px/18px Inter')).toBe(`600 calc(12px * ${S})/calc(18px * ${S}) Inter`)
  })

  it('touches only font-size, line-height and font', () => {
    const plugin = fontScaleCss()
    const decl = (prop: string, value: string) => { const d = { prop, value }; plugin.Declaration(d); return d.value }
    expect(decl('font-size', '12px')).toBe(`calc(12px * ${S})`)
    expect(decl('line-height', '18px')).toBe(`calc(18px * ${S})`)
    expect(decl('line-height', '1.4')).toBe('1.4')
    expect(decl('width', '12px')).toBe('12px')
    expect(decl('padding', '4px 8px')).toBe('4px 8px')
  })

  it('«Увеличенный» sets the scale on the root, «Стандартный» takes it off', () => {
    const root = document.createElement('html')
    applyFontSize('large', root)
    expect(root.style.getPropertyValue('--font-scale')).toBe(String(LARGE_FONT_SCALE))
    expect(root.getAttribute('data-font-size')).toBe('large')
    applyFontSize('standard', root)
    expect(root.style.getPropertyValue('--font-scale')).toBe('')
    expect(root.hasAttribute('data-font-size')).toBe(false)
  })
})
