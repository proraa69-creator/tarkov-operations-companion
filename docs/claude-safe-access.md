# Safe Claude access setup

Claude Code is installed locally and can be used to work with the project folders on this computer.

## Recommended launch mode

Use manual permission mode. In this mode Claude can inspect and edit project files, but it should ask before risky operations.

Start it from PowerShell with:

```powershell
.\start-claude-safe.ps1
```

## Faster project mode

For less interruption during ordinary code work, use:

```powershell
.\start-claude-auto-projects.ps1
```

This uses `acceptEdits` mode for the listed project folders. It is intended for project code edits and normal development commands. It still should not be treated as full unattended control of the entire Windows computer.

If Claude is not authenticated yet, it will ask you to sign in. Log in manually in the browser or terminal prompt.

## What Claude can safely do

- Work with the Tarkov Operations Companion source code.
- Read and edit the listed project folders.
- Run project commands such as tests, builds, and local dev servers.
- Use GitHub repositories after your GitHub/Claude app connection is active.

## What still needs your confirmation

Claude should ask before:

- Installing or uninstalling programs.
- Changing Windows settings.
- Touching system folders, game install folders, registry, firewall, services, or scheduled tasks.
- Changing payments, subscriptions, API keys, or account security.
- Running destructive Git or file deletion commands.

This keeps Claude useful without giving it uncontrolled full-computer access.

