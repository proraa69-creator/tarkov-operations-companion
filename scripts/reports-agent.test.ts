// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { allowedWords } from './reports-agent-gate.mjs'
import { AgentArgsError, parseCommand, publishedCommitOf, publishedReports, remoteCommand, roleOf } from './reports-agent.mjs'

/** scripts/reports-agent.mjs: what may reach the server's command line, and when a fix counts as «на сервере». */
const FIX = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)

describe('reports-agent: the command line on the server', () => {
  it('takes numbers and hashes only; a player\'s words cannot get there', () => {
    expect(parseCommand(['start', '12']).remote).toEqual(['start', '12'])
    expect(parseCommand(['pending']).remote).toEqual(['pending'])
    expect(parseCommand(['pending', '5']).remote).toEqual(['pending', '5'])
    expect(parseCommand(['published', '12', FIX]).remote).toEqual(['published', '12', FIX])
    for (const bad of [
      ['start', '12; rm -rf /'], ['start', '$(id)'], ['start', '0'], ['start'], ['pending', 'x'],
      ['published', '12', 'main'], ['published', '12', `${FIX}; id`], ['image', '12', '0;id', 'out.png'], ['triage', '12'], ['approve', '12'], [],
    ]) expect(() => parseCommand(bad), bad.join(' ')).toThrow(AgentArgsError)
  })

  it('the JSON goes through a file and stdin, never the arguments', () => {
    expect(parseCommand(['triage', '12', 'C:\\temp\\triage.json'])).toEqual({ remote: ['triage', '12'], inputFile: 'C:\\temp\\triage.json' })
    expect(parseCommand(['finish', '12', 'done.json'])).toEqual({ remote: ['finish', '12'], inputFile: 'done.json' })
  })

  it('every command this script can send goes with the key whose gate accepts it', () => {
    const commands = [['pending'], ['pending', '5'], ['triage', '12'], ['image', '12', '0'], ['jobs'], ['start', '12'], ['finish', '12'], ['done'], ['published', '12', FIX], ['release-busy']]
    for (const args of commands) {
      const other = roleOf(args) === 'triage' ? 'work' : 'triage'
      expect(allowedWords(roleOf(args), remoteCommand(args)), args.join(' ')).toEqual(args)
      expect(allowedWords(other, remoteCommand(args)), args.join(' ')).toBeNull()
    }
  })

  it('sends the words alone: where and as whom they run is the server\'s business', () => {
    expect(remoteCommand(['start', '12'])).toBe('start 12')
    expect(roleOf(['pending'])).toBe('triage')
    expect(roleOf(['jobs'])).toBe('work')
  })

  it('there is no command that gives a report to itself', () => {
    for (const word of ['approve', 'queue', 'work', 'queued']) expect(() => parseCommand([word, '12'])).toThrow(AgentArgsError)
  })
})

describe('reports-agent: «Добавлено на сервер»', () => {
  it('reads the commit of the published version', () => {
    expect(publishedCommitOf({ commit: `${HEAD}-production` })).toBe(HEAD)
    expect(publishedCommitOf({ commit: HEAD })).toBe(HEAD)
    for (const bad of [{ commit: 'unknown' }, { commit: 'abc-production' }, {}, null]) expect(publishedCommitOf(bad)).toBeNull()
  })

  it('only the fixes the published version really holds; a push alone is not enough', () => {
    const done = [{ number: 1, commit: FIX }, { number: 2, commit: 'c'.repeat(40) }, { number: 3, commit: 'd'.repeat(40) }, { number: 4, commit: 'не хеш' }]
    const holds = (commit: string, head: string) => {
      expect(head).toBe(HEAD)
      if (commit === 'd'.repeat(40)) throw new Error('git does not know it')
      return commit === FIX
    }
    expect(publishedReports(done, HEAD, holds)).toEqual([{ number: 1, commit: FIX }])
  })
})
