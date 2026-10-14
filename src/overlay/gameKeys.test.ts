import { describe, expect, it } from 'vitest'
import { gameKeyLabel, gameKeyVk, isPrintScreen, parseScreenshotBinding, parseScreenshotBindingAt, screenshotOnKey, unityKey } from './gameKeys'
import { HOTKEYS, hotkeyForGameKeys } from './hotkeys'

// The settings JSON EFT writes to application.log at start (shortened).
const SETTINGS_LINE = '2026-09-29 20:31:05.123|1.0.0.1.39234|Info|application|{"InvertedXAxis":false,"keyBindings":[{"keyName":"OpticCalibrationSwitchDown","variants":[{"keyCode":["PageDown"],"axisName":""},{"keyCode":[]}],"pressType":"Press"},{"keyName":"MakeScreenshot","variants":[{"keyCode":["F12"]},{"keyCode":[]}],"pressType":"Press"},{"keyName":"Recorder","variants":[{"keyCode":[]},{"keyCode":[]}],"pressType":"Release"}]}'

describe('screenshot key from the game log', () => {
  it('reads the bound key from the settings EFT logs', () => {
    expect(parseScreenshotBinding(SETTINGS_LINE)).toEqual(['F12'])
  })

  it('reads a key combination and skips an empty first variant', () => {
    expect(parseScreenshotBinding('"keyName":"MakeScreenshot","variants":[{"keyCode":["LeftAlt","F12"]},{"keyCode":[]}]')).toEqual(['LeftAlt', 'F12'])
    expect(parseScreenshotBinding('"keyName":"MakeScreenshot","variants":[{"keyCode":[]},{"keyCode":["Insert"]}]')).toEqual(['Insert'])
  })

  it('reads the pretty-printed settings file (Control.ini)', () => {
    const file = `{
  "keyBindings": [
    {
      "keyName": "LeanLockRight",
      "variants": [
        { "isAxis": false, "keyCode": [ "E" ], "axisName": "", "positiveAxis": false, "deadZone": 0.0, "sensitivity": 1.0 },
        { "isAxis": false, "keyCode": [], "axisName": null, "positiveAxis": false, "deadZone": 0.0, "sensitivity": 1.0 }
      ],
      "pressType": "Continuous"
    },
    {
      "keyName": "MakeScreenshot",
      "variants": [
        {
          "isAxis": false,
          "keyCode": [
            "F12"
          ],
          "axisName": "",
          "positiveAxis": false,
          "deadZone": 0.0,
          "sensitivity": 1.0
        },
        { "isAxis": false, "keyCode": [], "axisName": null, "positiveAxis": false, "deadZone": 0.0, "sensitivity": 1.0 }
      ],
      "pressType": "Press"
    }
  ]
}`
    expect(parseScreenshotBinding(file)).toEqual(['F12'])
  })

  it('tells "not bound" from "not logged" and uses the newest settings', () => {
    expect(parseScreenshotBinding('"keyName":"MakeScreenshot","variants":[{"keyCode":[]},{"keyCode":[]}]')).toEqual([])
    expect(parseScreenshotBinding('|application|LocationLoaded')).toBeNull()
    const rebound = `${SETTINGS_LINE}\n${SETTINGS_LINE.replace('["F12"]', '["Print"]')}`
    expect(parseScreenshotBinding(rebound)).toEqual(['Print'])
  })
})

describe('unity key names', () => {
  it('maps to Windows virtual keys', () => {
    expect(unityKey('Print')).toEqual({ vk: 0x2c, extended: true })
    expect(unityKey('SysReq')).toEqual({ vk: 0x2c, extended: true })
    expect(unityKey('F12')).toEqual({ vk: 0x7b, extended: false })
    expect(unityKey('V')).toEqual({ vk: 0x56, extended: false })
    expect(unityKey('Alpha5')).toEqual({ vk: 0x35, extended: false })
    expect(unityKey('Keypad0')).toEqual({ vk: 0x60, extended: false })
    expect(unityKey('Insert')).toEqual({ vk: 0x2d, extended: true })
    expect(unityKey('LeftAlt')).toEqual({ vk: 0xa4, extended: false })
    expect(unityKey('Mouse3')).toBeNull()
  })

  it('labels keys for the settings page', () => {
    expect(gameKeyLabel(['Print'])).toBe('PrtSc')
    expect(gameKeyLabel(['LeftAlt', 'F12'])).toBe('Left Alt + F12')
    expect(gameKeyLabel(['Keypad5'])).toBe('Num 5')
    expect(isPrintScreen(['SysReq'])).toBe(true)
    expect(isPrintScreen(['F12'])).toBe(false)
  })
})

// owner, 14.10.2026: «сделай что бы человек билдил кнопку в игре одну и туже куда он билдит миникарту в приложении».
describe('the game\'s screenshot on the minimap\'s key', () => {
  it('compares one key by its Windows key, mouse side buttons included', () => {
    expect(screenshotOnKey(['M'], HOTKEYS.KeyM!.vk)).toBe(true)
    expect(screenshotOnKey(['Alpha5'], HOTKEYS.Digit5!.vk)).toBe(true)
    expect(screenshotOnKey(['Mouse3'], HOTKEYS.Mouse4!.vk)).toBe(true)
    expect(screenshotOnKey(['Mouse4'], HOTKEYS.Mouse5!.vk)).toBe(true)
    expect(screenshotOnKey(['Mouse2'], HOTKEYS.MouseMiddle!.vk)).toBe(true)
    expect(screenshotOnKey(['Print'], HOTKEYS.KeyM!.vk)).toBe(false)
    expect(screenshotOnKey(['LeftAlt', 'M'], HOTKEYS.KeyM!.vk)).toBe(false)
    expect(screenshotOnKey([], HOTKEYS.KeyM!.vk)).toBe(false)
    expect(screenshotOnKey(['M'], undefined)).toBe(false)
    expect(gameKeyVk('Mouse0')).toBeNull()
  })

  it('finds the app hotkey for the game\'s key, none for PrtSc or a combination', () => {
    expect(hotkeyForGameKeys(['F12'])).toBe('F12')
    expect(hotkeyForGameKeys(['M'])).toBe('KeyM')
    expect(hotkeyForGameKeys(['Mouse3'])).toBe('Mouse4')
    expect(hotkeyForGameKeys(['Print'])).toBeNull()
    expect(hotkeyForGameKeys(['LeftAlt', 'F12'])).toBeNull()
  })
})

describe('when the game logged its screenshot key', () => {
  const settings = (key: string) => `{"keyBindings":[{"keyName":"MakeScreenshot","variants":[{"keyCode":["${key}"]},{"keyCode":[]}],"pressType":"Press"}]}`

  it('takes the newest binding and the time of its log line, to weigh it against Control.ini', () => {
    const text = `2026-10-14 10:00:01.120|1.0.0|Info|application|Controls: ${settings('Print')}\n`
      + `2026-10-14 11:30:05.500|1.0.0|Info|application|Controls: ${settings('M')}\n`
    expect(parseScreenshotBindingAt(text)).toEqual({ keys: ['M'], at: Date.parse('2026-10-14T11:30:05') })
  })

  it('has no time when no log line is in reach, and nothing when the binding is missing', () => {
    expect(parseScreenshotBindingAt(settings('F12'))).toEqual({ keys: ['F12'], at: 0 })
    expect(parseScreenshotBindingAt('2026-10-14 10:00:01|nothing here')).toBeNull()
  })
})
