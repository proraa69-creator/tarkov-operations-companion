#!/usr/bin/env node
// «Отчёты»: the only thing the two SSH keys of the agent can run on the server (docs/reports-agent.md). Each key stands in
// ~raidos-reports/.ssh/authorized_keys with `restrict,command="/usr/bin/node /usr/local/lib/raidos-reports/gate.mjs <role>"`,
// so what the client asked for arrives here as text in SSH_ORIGINAL_COMMAND, and sshd runs nothing else. No shell sees that
// text: it either matches a line below, word for word, or it is refused.
//
//   triage  reads new reports and writes the analysis: this key is used next to the players' words
//   work    what the owner gave away and its statuses; it cannot read a report
//
// Runs as the unprivileged `raidos-reports`, which may only start reports-agent-cli.sh as the server's user (one sudo line).
// Installed by hand, root:root (docs/reports-agent.md): the publisher does not touch it. Only Node built-ins here.
import { spawnSync } from 'node:child_process'
import { readSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPORT = '[1-9][0-9]{0,11}'

export const ROLES = {
  triage: [
    /^pending( [1-9][0-9]?)?$/,
    new RegExp(`^triage ${REPORT}$`),
    new RegExp(`^image ${REPORT} [0-9]{1,2}$`),
  ],
  work: [
    /^jobs$/,
    new RegExp(`^start ${REPORT}$`),
    new RegExp(`^finish ${REPORT}$`),
    /^done$/,
    new RegExp(`^published ${REPORT} [a-f0-9]{40}$`),
    /^release-busy$/,
  ],
}

const CLI = '/usr/local/lib/raidos-reports/cli'
const CLI_TIMEOUT_MS = 90_000
const MAX_INPUT_BYTES = 64 * 1024

/** The words of an allowed command, or null. `$` here ends the whole text: a second line cannot slip through. */
export function allowedWords(role, original) {
  const patterns = Object.hasOwn(ROLES, role) ? ROLES[role] : null
  if (!patterns || typeof original !== 'string') return null
  return patterns.some((pattern) => pattern.test(original)) ? original.split(' ') : null
}

/** A release must not meet a push (memory publisher-head-must-not-move); what cannot be told counts as busy. */
export function busyAnswer(state) {
  return { busy: state !== 'inactive' && state !== 'failed', state }
}

/** stdin with a limit, for the two commands that take JSON; null when there is too much. */
function readInput() {
  const parts = []
  let total = 0
  const buffer = Buffer.alloc(16 * 1024)
  for (;;) {
    let read
    try { read = readSync(0, buffer, 0, buffer.length, null) } catch (error) {
      if (error.code === 'EOF') break
      if (error.code === 'EAGAIN') continue
      throw error
    }
    if (read === 0) break
    total += read
    if (total > MAX_INPUT_BYTES) return null
    parts.push(Buffer.from(buffer.subarray(0, read)))
  }
  return Buffer.concat(parts)
}

function refuse(message) {
  console.log(JSON.stringify({ error: message }))
  return 1
}

export function main(role = process.argv[2], original = process.env.SSH_ORIGINAL_COMMAND) {
  const words = allowedWords(role, original)
  if (!words) return refuse('Команда не разрешена для этого ключа')
  if (words[0] === 'release-busy') {
    const result = spawnSync('/usr/bin/systemctl', ['is-active', 'raidos-release.service'], { encoding: 'utf8', timeout: 20_000 })
    console.log(JSON.stringify(busyAnswer(result.stdout?.trim() || 'unknown')))
    return 0
  }
  const takesInput = words[0] === 'triage' || words[0] === 'finish'
  const input = takesInput ? readInput() : Buffer.alloc(0)
  if (!input) return refuse('Слишком большой ввод')
  const result = spawnSync('/usr/bin/sudo', ['-n', '-u', 'raidos-api', CLI, ...words], { input, stdio: ['pipe', 'inherit', 'inherit'], timeout: CLI_TIMEOUT_MS })
  return result.status ?? 1
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === fileURLToPath(import.meta.url)) process.exitCode = main()
