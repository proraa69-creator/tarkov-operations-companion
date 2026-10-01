import { describe, expect, it, vi } from 'vitest'
import { describeBuild, isOurImage, isStaleOwnServer, stopOwnServerOnPort } from './staleServer'

const running = { version: '0.5.4', build: 42, commit: 'abc1234' }
const ours = (build?: { version: string; build: number; commit: string }) => ({ ok: true, service: 'tarkov-operations-api', ...(build ? { build } : {}) })

describe('old server on the API port', () => {
  it('recognises our own API from another build, never a stranger or a development run', () => {
    expect(isStaleOwnServer(ours(), running)).toBe(true) // older than build info
    expect(isStaleOwnServer(ours({ version: '0.5.3', build: 40, commit: 'fff0000' }), running)).toBe(true)
    expect(isStaleOwnServer(ours({ version: '0.5.4', build: 42, commit: 'abc1234' }), running)).toBe(false)
    expect(isStaleOwnServer({ ok: true, service: 'something-else' }, running)).toBe(false)
    expect(isStaleOwnServer(null, running)).toBe(false)
    expect(isStaleOwnServer(ours(), { ...running, build: 0 })).toBe(false)
  })

  it('describes the build for the status lamp', () => {
    expect(describeBuild(ours({ version: '0.5.3', build: 40, commit: 'fff0000aaaa' }))).toBe('0.5.3 #40 (fff0000)')
    expect(describeBuild(ours())).toBe('неизвестная (старая)')
  })

  it('stops it only when /health says it is ours AND the process runs our own executable', async () => {
    const kill = vi.fn()
    const deps = { listeningPid: async () => 4321, processImage: async () => 'Tarkov Operator.exe', kill }
    const execOk = 'C:\\Apps\\Tarkov Operator.exe'
    expect(isOurImage('tarkov operator.exe', execOk)).toBe(true)
    expect(isOurImage('node.exe', execOk)).toBe(false)

    // A stranger answering on the port: never stopped.
    expect((await stopOwnServerOnPort(8787, { ok: true, service: 'nginx' }, deps)).stopped).toBe(false)
    // Ours by /health, but the process is another program: not stopped.
    const foreign = await stopOwnServerOnPort(8787, ours(), { ...deps, processImage: async () => 'node.exe' })
    expect(foreign.stopped).toBe(false)
    expect(foreign.reason).toContain('node.exe')
    expect(kill).not.toHaveBeenCalled()
    // Unknown PID: not stopped.
    expect((await stopOwnServerOnPort(8787, ours(), { ...deps, listeningPid: async () => null })).stopped).toBe(false)
    expect(kill).not.toHaveBeenCalled()
  })

  it('stops our own old server process', async () => {
    const kill = vi.fn()
    const image = process.execPath.split(/[\\/]/).pop()!
    const result = await stopOwnServerOnPort(8787, ours(), { listeningPid: async () => 4321, processImage: async () => image, kill })
    expect(result.stopped).toBe(true)
    expect(kill).toHaveBeenCalledWith(4321)
  })
})
