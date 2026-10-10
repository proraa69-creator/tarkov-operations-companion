// @vitest-environment node
import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chooseBoot, confirmBoot, markBad, readDeltaState, writeDeltaState, type DeltaState } from './deltaBoot'

const PACKAGED = { edition: 'owner', build: 1791000000000 }
const NEW = 1792000000000
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function staged(state: DeltaState = { current: { build: NEW, version: '0.5.5', commit: 'c', dir: String(NEW) } }) {
  const root = mkdtempSync(join(tmpdir(), 'raidos-boot-'))
  dirs.push(root)
  mkdirSync(join(root, String(NEW)), { recursive: true })
  writeFileSync(join(root, String(NEW), 'app.asar'), 'archive')
  writeDeltaState(fs, root, state)
  return root
}

const dead = () => false
const alive = () => true

describe('which build the owner app starts (partial update)', () => {
  it('starts a newer staged build and marks this start pending until the page loads', () => {
    const root = staged()
    const choice = chooseBoot({ fs, root, packaged: PACKAGED, pid: 100, alive: dead })
    expect(choice).toEqual({ build: NEW, main: join(root, String(NEW), 'app.asar', 'dist-electron', 'electron', 'main.js') })
    expect(readDeltaState(fs, root).pending).toEqual({ build: NEW, pid: 100 })
    expect(confirmBoot(fs, root, 999)).toBe(false)
    expect(confirmBoot(fs, root, 100)).toBe(true)
    expect(readDeltaState(fs, root).pending).toBeUndefined()
    expect(readDeltaState(fs, root).confirmed).toEqual([NEW])
    // Confirmed once: later starts need no pending mark.
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 200, alive: dead })?.build).toBe(NEW)
    expect(readDeltaState(fs, root).pending).toBeUndefined()
  })

  it('goes back to the exe\'s own build when the last start never loaded its page', () => {
    const root = staged()
    chooseBoot({ fs, root, packaged: PACKAGED, pid: 100, alive: dead })
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 101, alive: dead })).toBeNull()
    expect(readDeltaState(fs, root).bad).toEqual([NEW])
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 102, alive: dead })).toBeNull()
  })

  it('a second launch while the first still runs is not a failure', () => {
    const root = staged()
    chooseBoot({ fs, root, packaged: PACKAGED, pid: 100, alive: dead })
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 101, alive })?.build).toBe(NEW)
    expect(readDeltaState(fs, root).pending).toEqual({ build: NEW, pid: 100 })
  })

  it('never for the players\' exe, an older staged build, a bad one or a missing archive', () => {
    expect(chooseBoot({ fs, root: staged(), packaged: { ...PACKAGED, edition: 'client' }, pid: 1, alive: dead })).toBeNull()
    expect(chooseBoot({ fs, root: staged(), packaged: { ...PACKAGED, build: NEW }, pid: 1, alive: dead })).toBeNull()
    const bad = staged()
    markBad(fs, bad, NEW)
    expect(chooseBoot({ fs, root: bad, packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
    const missing = staged()
    rmSync(join(missing, String(NEW)), { recursive: true })
    expect(chooseBoot({ fs, root: missing, packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
    // A state file pointing outside its folder is ignored.
    const outside = staged({ current: { build: NEW, version: 'x', commit: 'c', dir: '../elsewhere' } })
    expect(chooseBoot({ fs, root: outside, packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
    expect(chooseBoot({ fs, root: join(tmpdir(), 'raidos-no-such-folder'), packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
  })
})
