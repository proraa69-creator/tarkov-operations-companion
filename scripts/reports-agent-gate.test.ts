// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { allowedWords, busyAnswer } from './reports-agent-gate.mjs'

/** scripts/reports-agent-gate.mjs: what the two limited SSH keys can make the server do, and nothing else. */
const HASH = 'a'.repeat(40)

describe('reports-agent-gate: what each key may ask', () => {
  it('the analysis key: new reports, their pictures, the analysis', () => {
    expect(allowedWords('triage', 'pending')).toEqual(['pending'])
    expect(allowedWords('triage', 'pending 5')).toEqual(['pending', '5'])
    expect(allowedWords('triage', 'triage 12')).toEqual(['triage', '12'])
    expect(allowedWords('triage', 'image 12 0')).toEqual(['image', '12', '0'])
  })

  it('the work key: jobs and their statuses', () => {
    expect(allowedWords('work', 'jobs')).toEqual(['jobs'])
    expect(allowedWords('work', 'start 12')).toEqual(['start', '12'])
    expect(allowedWords('work', 'finish 12')).toEqual(['finish', '12'])
    expect(allowedWords('work', 'done')).toEqual(['done'])
    expect(allowedWords('work', `published 12 ${HASH}`)).toEqual(['published', '12', HASH])
    expect(allowedWords('work', 'release-busy')).toEqual(['release-busy'])
  })

  it('a key does not reach the other role: the analysis cannot move a job, the work cannot read a report', () => {
    for (const command of ['jobs', 'start 12', 'finish 12', 'done', `published 12 ${HASH}`, 'release-busy']) expect(allowedWords('triage', command), command).toBeNull()
    for (const command of ['pending', 'pending 5', 'triage 12', 'image 12 0']) expect(allowedWords('work', command), command).toBeNull()
  })

  it('anything else is refused, and there is no shell to reach', () => {
    const attempts = [
      undefined, '', ' ', 'id', 'whoami', 'bash', 'sh -c id', 'cat /etc/passwd', 'scp -t /tmp', 'internal-sftp', '/usr/lib/openssh/sftp-server', 'rsync --server . /tmp',
      'pending; id', 'pending && id', 'pending | id', 'pending\nid', 'pending\n', ' pending', 'pending ', 'pending  5', 'pending 0', 'pending 100', 'pending $(id)', 'pending `id`',
      'triage', 'triage 0', 'triage -1', 'triage 12 13', 'triage 12;id', 'triage ../../etc/passwd', 'triage 1234567890123',
      'image 12', 'image 12 100', 'image 12 0 /tmp/x', 'image 12 -1',
      'jobs --all', 'start', 'finish 12 x', 'done now', `published 12 ${HASH.slice(1)}`, `published 12 ${HASH.toUpperCase()}`, `published 12 ${HASH}; id`, 'published 12 main',
      'release-busy now', 'approve 12', 'queue 12', 'queued 12', 'Pending',
      `cd /opt && exec runuser -u raidos-api -- env TARKOV_DB_PATH=/var/lib/raidos/companion.sqlite node --import tsx src/cli/reportsAgent.ts jobs`,
    ]
    for (const role of ['triage', 'work']) for (const attempt of attempts) expect(allowedWords(role, attempt), `${role}: ${attempt}`).toBeNull()
  })

  it('an unknown role has no commands, whatever it is called', () => {
    for (const role of [undefined, '', 'root', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(allowedWords(role as string, 'jobs'), String(role)).toBeNull()
  })

  it('no command gives a report to itself', () => {
    for (const role of ['triage', 'work']) for (const word of ['approve', 'queue', 'queued', 'work', 'plan', 'reject']) expect(allowedWords(role, `${word} 12`)).toBeNull()
  })
})

describe('reports-agent-gate: is a release running', () => {
  it('only a stopped or failed publisher lets a push go', () => {
    expect(busyAnswer('inactive')).toEqual({ busy: false, state: 'inactive' })
    expect(busyAnswer('failed')).toEqual({ busy: false, state: 'failed' })
    for (const state of ['active', 'activating', 'deactivating', 'unknown', '']) expect(busyAnswer(state).busy, state).toBe(true)
  })
})
