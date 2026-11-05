#!/usr/bin/env node
// «Отчёты» (owner, 05.11.2026; docs/reports-agent.md): how Claude on the owner's computer talks to the table. Each command
// runs server/src/cli/reportsAgent.ts next to the server over SSH, as the server's user, with the key the owner's computer
// already has. No API key, no public route for it.
//
//   node scripts/reports-agent.mjs pending [limit]            new reports to analyse, JSON
//   node scripts/reports-agent.mjs triage <n> <file.json>     { summary, plan }; moves no status
//   node scripts/reports-agent.mjs jobs                       what the owner gave away, JSON
//   node scripts/reports-agent.mjs start <n>                  takes a job: «В работе»
//   node scripts/reports-agent.mjs finish <n> <file.json>     { outcome: done | failed, note, commit? }
//   node scripts/reports-agent.mjs image <n> <index> <file>   saves a report's screenshot
//   node scripts/reports-agent.mjs sync-published [repo]      «Добавлено на сервер» for the fixes the published version holds
//   node scripts/reports-agent.mjs release-busy               is a release running now? Then nothing may be pushed
//
// A player's words never pass through a command line or a shell: only numbers and commit hashes go there, checked below;
// the JSON goes through stdin. RAIDOS_REPORTS_SSH overrides user@host, RAIDOS_REPORTS_SSH_KEY the key file.
// Exit codes: 0 done, 1 the server refused or could not be reached, 2 wrong arguments. Only Node built-ins here.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION_URL = 'https://raidos.app/download/version.json'
const DEFAULT_SSH = 'root@129.101.117.231'
const SERVER_DIR = '/opt/tarkov-operations-companion/server'
const DB = '/var/lib/raidos/companion.sqlite'
const NUMBER = /^[1-9][0-9]{0,11}$/
const INDEX = /^[0-9]{1,2}$/
const COMMIT = /^[a-f0-9]{40}$/
const MAX_INPUT_BYTES = 64 * 1024

export class AgentArgsError extends Error {}

/** The command on the server: fixed words, and arguments that have passed the checks above. */
export function remoteCommand(args) {
  return `cd ${SERVER_DIR} && exec runuser -u raidos-api -- env TARKOV_DB_PATH=${DB} node --import tsx src/cli/reportsAgent.ts ${args.join(' ')}`
}

function number(value, label = 'номер отчёта') {
  if (!NUMBER.test(value ?? '')) throw new AgentArgsError(`Нужен ${label}`)
  return value
}

/** What to run for these arguments: `remote` (checked arguments) and `inputFile` (JSON for stdin), or a local command. */
export function parseCommand(argv) {
  const [command, first, second, third] = argv
  switch (command) {
    case 'pending': return { remote: first === undefined ? ['pending'] : ['pending', number(first, 'предел')] }
    case 'jobs': return { remote: ['jobs'] }
    case 'done': return { remote: ['done'] }
    case 'start': return { remote: ['start', number(first)] }
    case 'triage':
    case 'finish':
      if (!second) throw new AgentArgsError('Нужен файл с JSON')
      return { remote: [command, number(first)], inputFile: second }
    case 'image':
      if (!INDEX.test(second ?? '') || !third) throw new AgentArgsError('Нужны номер изображения и файл')
      return { remote: ['image', number(first), second], outputFile: third }
    case 'published':
      if (!COMMIT.test(second ?? '')) throw new AgentArgsError('Нужен полный хеш опубликованного коммита')
      return { remote: ['published', number(first), second] }
    case 'sync-published': return { local: 'sync-published', repo: first ?? process.cwd() }
    case 'release-busy': return { local: 'release-busy' }
    default: throw new AgentArgsError('Команды: pending, triage, jobs, start, finish, done, image, published, sync-published, release-busy')
  }
}

/** The commit of the published version («<40 hex>-production»), or null when the answer does not say. */
export function publishedCommitOf(version) {
  const match = /^([a-f0-9]{40})(?:-|$)/.exec(typeof version?.commit === 'string' ? version.commit : '')
  return match ? match[1] : null
}

/** Done reports whose fix the published version holds. A commit git cannot place counts as not there yet. */
export function publishedReports(done, published, isAncestor) {
  return done.filter(({ commit }) => {
    try { return COMMIT.test(commit) && isAncestor(commit, published) } catch { return false }
  })
}

function ssh(remote, input) {
  const key = process.env.RAIDOS_REPORTS_SSH_KEY ?? join(homedir(), '.ssh', 'raidos_deploy_ed25519')
  const target = process.env.RAIDOS_REPORTS_SSH ?? DEFAULT_SSH
  return spawnSync('ssh', ['-i', key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', target, remote], { input: input ?? '', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 })
}

function callServer(args, input) {
  const result = ssh(remoteCommand(args), input)
  if (result.error) throw new Error(`Нет связи с сервером: ${result.error.message}`)
  const line = result.stdout.trim().split('\n').at(-1) ?? ''
  let answer
  try { answer = JSON.parse(line) } catch { throw new Error(`Сервер не ответил JSON (код ${result.status}): ${result.stderr.trim().slice(-400)}`) }
  if (result.status !== 0) throw new Error(typeof answer?.error === 'string' ? answer.error : `Код ${result.status}`)
  return answer
}

async function syncPublished(repo) {
  const response = await fetch(VERSION_URL, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`${VERSION_URL}: HTTP ${response.status}`)
  const published = publishedCommitOf(await response.json())
  if (!published) throw new Error('В опубликованной версии нет коммита')
  const { reports: done } = callServer(['done'])
  if (!done.length) return { published, added: [] }
  execFileSync('git', ['-C', repo, 'fetch', '--quiet', 'origin', 'release/production'], { stdio: 'ignore', timeout: 120_000 })
  const holds = (commit, head) => spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', commit, head], { stdio: 'ignore' }).status === 0
  const added = publishedReports(done, published, holds)
  for (const { number: id } of added) callServer(['published', String(id), published])
  return { published, added: added.map(({ number: id }) => id) }
}

function readInput(file) {
  const text = readFileSync(file, 'utf8')
  if (Buffer.byteLength(text) > MAX_INPUT_BYTES) throw new AgentArgsError('Файл слишком большой')
  return text
}

export async function main(argv = process.argv.slice(2)) {
  let command
  try {
    command = parseCommand(argv)
    if (command.local === 'sync-published') { console.log(JSON.stringify(await syncPublished(command.repo))); return 0 }
    if (command.local === 'release-busy') {
      const result = ssh('systemctl is-active raidos-release.service')
      const state = result.stdout.trim()
      if (result.error || !state) throw new Error('Нет связи с сервером')
      console.log(JSON.stringify({ busy: state !== 'inactive' && state !== 'failed', state }))
      return 0
    }
    const answer = callServer(command.remote, command.inputFile ? readInput(command.inputFile) : undefined)
    if (command.outputFile) {
      writeFileSync(command.outputFile, Buffer.from(answer.data, 'base64'))
      console.log(JSON.stringify({ file: command.outputFile, mime: answer.mime }))
      return 0
    }
    console.log(JSON.stringify(answer))
    return 0
  } catch (error) {
    console.error(error.message)
    return error instanceof AgentArgsError ? 2 : 1
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === fileURLToPath(import.meta.url)) main().then((code) => { process.exitCode = code })
