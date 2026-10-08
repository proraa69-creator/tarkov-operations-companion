# Unsigned iOS build for the owner

## Goal

Build an unsigned Raid OS `.ipa` in GitHub Actions for installation on the owner's iPhone with Sideloadly on Windows. The iOS bundle must be produced from the same `release/production` commit as the tested Windows release, use the production API at `https://raidos.app`, and contain the current shared React UI and game data.

## Source of truth

- Trigger only on pushes to `release/production`.
- Build the exact pushed commit; do not pull from `main`, a Claude work branch, or a deployed VPS checkout.
- Use `package.json` for the marketing version and the GitHub run number for the iOS build number.
- Keep the existing bundle identifier `com.tarkovoperator.app` so repeated Sideloadly installs update the same app.

## Pipeline

1. Check out the exact commit with persisted GitHub credentials disabled.
2. On Ubuntu, install locked npm dependencies with Node 24 and run the same renderer typecheck and unit tests as the production gate.
3. Only after verification succeeds, install the same locked dependencies on the macOS runner.
4. Build the current renderer and run `cap sync ios`.
5. Compile the native iOS target for a generic physical device with code signing disabled.
6. Validate the bundle identifier, version, executable and embedded web assets.
7. Package `Payload/App.app` as an unsigned `.ipa`, produce a SHA-256 file and upload both as a GitHub Actions artifact.

No Apple password, certificate, provisioning profile, server key or application database is stored in GitHub. Sideloadly performs personal signing on the owner's Windows computer.

## Product parity

The phone uses the same renderer and centralized API as the Windows client. Account state, PvP/PvE/Season progress, quests, maps, flea data, traders, ballistics, gallery, weapon builder, Kappa requirements, squad and settings therefore come from the release source and server.

Windows-only capabilities remain intentionally unavailable on iOS: reading local EFT logs, taking screenshots, OCR hotkeys, native game overlays and the Windows executable updater. Their synchronized results can still be viewed on the phone after the Windows client uploads them to the API.

## Acceptance criteria

- A push to `release/production` creates an artifact named `Raid-OS-iOS-<version>-<sha>` only after checks pass.
- The artifact contains one `.ipa` and its `.sha256` file.
- The `.ipa` contains `Payload/App.app`, `Info.plist`, the native executable and Capacitor web assets.
- `CFBundleIdentifier` is `com.tarkovoperator.app`; the marketing version matches `package.json`.
- No signing material or user data is present in the workflow or artifact.
