# Raid OS — Claude working notes

This repository contains the Raid OS desktop client, website and centralized VPS API.

## Shared Codex / Claude Context

Before working, read `docs/coordination/LATEST.json`, `PROJECT_STATE.md`, `WORK_QUEUE.md`, `COORDINATION.md` and `WORK_LOG.md`.
This `sync/codex-claude-context` branch captures deployed source changes that were not committed in the VPS checkout.
It is not main and is not an automatic production deployment. Use separate feature branches and declare owned files before editing.
Preserve other agents' changes; one release integrator at a time. Never expose credentials or copy the live account database into Git.
Startup-only application auto-update and metadata notifications are separate. Do not install during a raid or on app close.
Do not re-enable the disabled 15-minute server deploy agent, activate disabled checkout buttons, or publish the Overview preview without the owner's direction.
After each task update the shared work log with commit, files, tests, deployment state and remaining risks.
The hourly context monitor only refreshes information/snapshots; it does not deploy application code.

## Project facts

- Main GitHub repository: `https://github.com/proraa69-creator/tarkov-operations-companion`
- Current package version: `0.5.4`
- App type: Electron desktop shell with React/Vite renderer and local/server preparation code.
- Product name in package config: `Raid OS`
- Windows portable build output: `release/Raid OS 0.5.4.exe` (separate release directories for client/owner builds)
- Public Windows download: `https://raidos.app/download/windows`; signed manifest: `/download/version.json`
- Linux VPS server (Ubuntu, Timeweb): `docs/linux-server.md` (bundle: `node scripts/build-linux-server.mjs <out>` after `npm run build`)
- Product/business roadmap and streamer referral context: `docs/product-roadmap-and-business-model.md`

## Useful commands

- Install dependencies: `npm install`
- Start renderer dev server: `npm run dev`
- Build renderer and Electron code: `npm run build`
- Build Windows portable exe: `npm run dist:win`
- Type-check: `npm run typecheck`
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- Lint: `npm run lint`
- Server dev mode: `npm run server:dev`
- Server tests: `npm run server:test`
- Phone app (Capacitor, see `docs/mobile.md`): `npm run mobile:build` (vite build + cap sync), `npm run android:apk`, `npm run ios:open` (macOS/Xcode)

## Safety rules for this computer

The user wants Claude to help with local projects and setup, but not to silently take full control of Windows.

Do not perform these actions without explicit user approval for the exact operation:

- Change Windows system settings, registry, firewall, antivirus, startup items, scheduled tasks, services, drivers, or network settings.
- Install, uninstall, or update software outside normal project dependencies.
- Delete or overwrite broad folders, especially user profile folders, desktop, documents, repository roots, game folders, or system folders.
- Run destructive Git commands such as `git reset --hard`, `git clean -fdx`, or force-push.
- Change GitHub, payment, subscription, auth, OAuth, or API-key settings.
- Open paid external services, create paid infrastructure, or start subscriptions.

Never use `--dangerously-skip-permissions` for normal work. Prefer manual permission mode so the user can approve risky steps.

## Data and secret handling

- Do not commit `.env`, API keys, logs, local cache, build outputs, `.exe` files, `node_modules`, screenshots with secrets, or user-private account files.
- If a secret appears in chat, terminal output, or a file, treat it as compromised and tell the user to rotate it.
- Keep app data source changes traceable. Do not silently replace user data or generated game databases without explaining what changed.

## Development expectations

- Preserve existing user changes. Inspect `git status` before large edits.
- Prefer small, reviewable commits or patches.
- Before changing subscription, referral, server, payment, quest, map, profile, or protected-data behavior, read `docs/product-roadmap-and-business-model.md`.
- For UI changes, test both Russian and English language switching when relevant.
- For Tarkov data features, keep PvP, PvE, and Season profiles separated.
- Do not claim that live inventory, equipped gear, or exact in-raid location can be read unless it is actually implemented and verified.
- The app must not automate gameplay, inject into Escape from Tarkov, or bypass game protections.

