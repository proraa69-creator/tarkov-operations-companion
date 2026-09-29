import { describe, expect, it } from 'vitest'
import { gameKeyLabel, isPrintScreen, parseScreenshotBinding, unityKey } from './gameKeys'

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
