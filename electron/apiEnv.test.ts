// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apiChildEnv, apiProcessEnv } from './apiEnv'

describe('API process environment (L6)', () => {
  const parent = {
    PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', NODE_ENV: 'production',
    TARKOV_MAX_DEVICES: '3', YOOKASSA_SHOP_ID: '1', LAVA_API_KEY: 'k', TARKOV_SMS_PROVIDER: 'x', TARKOV_EMAIL_FROM: 'a@b.c',
    RAIDOS_UPDATE_SIGNING_KEY: 'private', RAIDOS_UPDATE_SIGNING_KEY_FILE: 'C:\\keys\\update.pem', GITHUB_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 'aws',
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--require evil.js', PORTABLE_EXECUTABLE_FILE: 'C:\\Raid OS.exe',
  }

  it('passes the run-time basics and the variables the server reads', () => {
    expect(apiProcessEnv(parent)).toEqual({
      PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', TEMP: 'C:\\Temp', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', NODE_ENV: 'production',
      TARKOV_MAX_DEVICES: '3', YOOKASSA_SHOP_ID: '1', LAVA_API_KEY: 'k', TARKOV_SMS_PROVIDER: 'x', TARKOV_EMAIL_FROM: 'a@b.c',
    })
  })

  it('never passes the update signing key, even when the app sets it itself', () => {
    const env = apiChildEnv(parent, { PORT: '8787', RAIDOS_UPDATE_SIGNING_KEY: 'x', TARKOV_PUBLIC_URL: 'https://raidos.app' })
    expect(Object.keys(env).filter((name) => name.startsWith('RAIDOS_UPDATE_SIGNING_KEY'))).toEqual([])
    expect(env).toMatchObject({ PORT: '8787', TARKOV_PUBLIC_URL: 'https://raidos.app', PATH: 'C:\\Windows' })
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
  })

  it('every variable server/src reads through process.env / env.X is on the list', () => {
    const allowed = apiProcessEnv(Object.fromEntries(serverEnvNames().map((name) => [name, 'x'])))
    expect(serverEnvNames().filter((name) => !(name in allowed))).toEqual([])
  })

  it('localServer.ts starts the API with the allowlisted environment, not all of process.env', () => {
    const source = readFileSync(join(__dirname, 'localServer.ts'), 'utf8')
    expect(source).toContain('env: apiChildEnv(process.env,')
    expect(source).not.toMatch(/env: \{ \.\.\.process\.env/)
  })
})

function serverEnvNames() {
  const root = join(__dirname, '..', 'server', 'src')
  const names = new Set<string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
        for (const match of readFileSync(path, 'utf8').matchAll(/(?:process\.env|\benv)\.([A-Z][A-Z0-9_]+)/g)) names.add(match[1])
      }
    }
  }
  walk(root)
  return [...names]
}
