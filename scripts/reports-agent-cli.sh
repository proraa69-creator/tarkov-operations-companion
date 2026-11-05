#!/bin/sh
# «Отчёты» (docs/reports-agent.md): the one thing `raidos-reports` may start as the server's user, by one line in sudoers.
# reports-agent-gate.mjs has checked the arguments, and the command below knows only the commands of the table.
# Installed by hand as /usr/local/lib/raidos-reports/cli, root:root 0755.
cd /opt/tarkov-operations-companion/server || exit 1
exec /usr/bin/env TARKOV_DB_PATH=/var/lib/raidos/companion.sqlite /usr/bin/node --import tsx src/cli/reportsAgent.ts "$@"
