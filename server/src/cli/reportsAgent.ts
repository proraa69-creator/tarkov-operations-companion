/**
 * The door for Claude on the owner's computer into «Отчёты» (services/reportsAgent.ts, docs/reports-agent.md). Run next to
 * the server, as its user, from the server's folder; scripts/reports-agent.mjs does it by SSH:
 *
 *   node --import tsx src/cli/reportsAgent.ts <command> [arguments]     (JSON on stdin for triage and finish)
 *
 * Answers one line of JSON on stdout. A refusal: { "error": "…" } on stdout too, exit code 1.
 */
import { readFileSync } from 'node:fs'
import { openDatabase, resolveDbPath } from '../services/database.js'
import { BugReportError, BugReportStore } from '../services/bugReportStore.js'
import { runReportsAgent } from '../services/reportsAgent.js'

const args = process.argv.slice(2)
const stdin = args[0] === 'triage' || args[0] === 'finish' ? readFileSync(0, 'utf8') : ''
const db = openDatabase(resolveDbPath())
try {
  console.log(JSON.stringify(runReportsAgent(new BugReportStore(db, { prune: false }), args, stdin)))
} catch (error) {
  if (!(error instanceof BugReportError)) throw error
  console.log(JSON.stringify({ error: error.message, status: error.status }))
  process.exitCode = 1
} finally {
  db.close()
}
