import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { SettingHelp } from './SettingHelp'
import { SETTING_HELP } from './settingHelpTexts'

const TEXT = SETTING_HELP.clickVolume
const circle = () => screen.getByRole('button', { name: /^(Что это\?|What is this\?)$/ })
const tip = () => screen.queryByRole('tooltip')
const draw = (locale = 'ru') => {
  localStorage.setItem('tarkov-operations-locale-v1', locale)
  return render(<LocaleProvider><SettingHelp id="clickVolume" /><span>рядом</span></LocaleProvider>)
}
// jsdom has no PointerEvent: the pointer's kind is written onto the event the tests send.
const pointer = (type: string, element: Element, pointerType: string) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  act(() => { element.dispatchEvent(event) })
}

afterEach(() => { cleanup(); localStorage.clear() })

describe('the question mark beside a setting (owner, 06.11.2026, №76: «наводишь мышь, и появляется окно помощник»)', () => {
  it('the mouse: shown while it is on the circle, gone when it leaves', () => {
    draw()
    expect(tip()).toBeNull()
    fireEvent.pointerEnter(circle())
    expect(tip()?.textContent).toBe(TEXT.ru)
    expect(circle().getAttribute('aria-describedby')).toBe(tip()?.id)
    fireEvent.pointerLeave(circle())
    expect(tip()).toBeNull()
  })

  it('a press with the mouse leaves it open, and no `title` calls the other small window', () => {
    draw()
    fireEvent.pointerEnter(circle())
    fireEvent.pointerDown(circle())
    fireEvent.click(circle())
    expect(tip()?.textContent).toBe(TEXT.ru)
    expect(circle().hasAttribute('title')).toBe(false)
  })

  it('in English it speaks English', () => {
    draw('en')
    fireEvent.pointerEnter(circle())
    expect(tip()?.textContent).toBe(TEXT.en)
  })

  it('a phone has no mouse: a tap opens it, a second tap closes it, the finger passing over does nothing', () => {
    draw()
    pointer('pointerover', circle(), 'touch')
    expect(tip()).toBeNull()
    pointer('pointerdown', circle(), 'touch')
    fireEvent.focus(circle())
    fireEvent.click(circle())
    expect(tip()?.textContent).toBe(TEXT.ru)
    pointer('pointerdown', circle(), 'touch')
    fireEvent.click(circle())
    expect(tip()).toBeNull()
  })

  it('a tap anywhere else closes it (an iPhone gives a button no focus to lose), and so do Esc and a scroll', () => {
    draw()
    const open = () => { pointer('pointerdown', circle(), 'touch'); fireEvent.click(circle()); expect(tip()).not.toBeNull() }
    open()
    pointer('pointerdown', screen.getByText('рядом'), 'touch')
    expect(tip()).toBeNull()
    fireEvent.click(circle())
    expect(tip()).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(tip()).toBeNull()
    fireEvent.click(circle())
    fireEvent.scroll(window)
    expect(tip()).toBeNull()
  })

  it('the keyboard: shown with the focus, gone without it', () => {
    draw()
    fireEvent.focus(circle())
    expect(tip()?.textContent).toBe(TEXT.ru)
    fireEvent.blur(circle())
    expect(tip()).toBeNull()
  })
})

const CYRILLIC = /[А-Яа-яЁё]/
/** The sources behind the settings a player sees on «Настройки»: the owner's own panels (server, tunnel, payouts) are his. */
const SETTINGS_FILES = [
  'src/components/AppUpdateSettings.tsx',
  'src/components/ClickVolumeSetting.tsx',
  'src/components/ThemePicker.tsx',
  'src/mobile/AndroidUpdatePanel.tsx',
  'src/mobile/backNavigation.tsx',
  'src/onboarding/GuideReplaySetting.tsx',
  'src/pages/RaidToolsSettings.tsx',
  'src/restock/RestockWidgets.tsx',
  'src/screen/PresetTriggers.tsx',
  'src/theme/alcantara/StitchChooser.tsx',
]
const source = (path: string) => readFileSync(path, 'utf8')
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : []
  })
}

describe('the texts', () => {
  it('short, and each in its own language', () => {
    for (const [id, { ru, en }] of Object.entries(SETTING_HELP)) {
      expect(`${id}: ${ru.length}`, ru).toBe(`${id}: ${Math.min(ru.length, 170)}`)
      expect(`${id}: ${en.length}`, en).toBe(`${id}: ${Math.min(en.length, 170)}`)
      expect(CYRILLIC.test(ru), id).toBe(true)
      expect(CYRILLIC.test(en), id).toBe(false)
    }
  })

  it('each is used, and none is used for two things', () => {
    const everything = files('src').map(source).join('\n')
    const fixed = [...everything.matchAll(/<SettingHelp id="(\w+)"/g)].map((match) => match[1]!)
    const passed = [...everything.matchAll(/help="(\w+)"/g), ...everything.matchAll(/name === 'hotkey' \? '(\w+)' : '(\w+)'/g)].flatMap((match) => match.slice(1))
    expect([...fixed, ...passed].sort()).toEqual(Object.keys(SETTING_HELP).sort())
  })
})

describe('every setting has one', () => {
  // A row's name is in its first <strong>: the circle stands right after it. The rows that only report a state have no name.
  it.each(SETTINGS_FILES)('%s: every row with a name', (path) => {
    const text = source(path)
    const rows = text.split('setting-row').slice(1)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const name = /<strong>([\s\S]*?)<\/strong>/.exec(row)?.[1]
      if (name) expect(name).toMatch(/<SettingHelp /)
    }
  })

  it('«Настройки»: the rows of the page itself', () => {
    const text = source('src/pages/ReferencePages.tsx')
    const page = text.slice(text.indexOf('function SupportPanel'))
    const rows = page.split('"setting-row"').slice(1)
    expect(rows).toHaveLength(3)
    for (const row of rows) expect(/<strong>([\s\S]*?)<\/strong>/.exec(row)?.[1]).toMatch(/<SettingHelp /)
  })
})
