# Tarkov Operator — Claude working notes

This repository contains the current Tarkov APP / Tarkov Operator desktop client.

## Project facts

- Main GitHub repository: `https://github.com/proraa69-creator/tarkov-operations-companion`
- Current package version: `0.5.4`
- App type: Electron desktop shell with React/Vite renderer and local/server preparation code.
- Product name in package config: `Tarkov Operator`
- Windows portable build output: `release/Tarkov Operator 0.5.4.exe`
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

