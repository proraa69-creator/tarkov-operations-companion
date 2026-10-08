# RaidOS Repair Checkpoint

Published: 2026-10-08. Client version 0.5.4, build 1791457737377.
Build label: ec0af4f-overlay-story-update-complete (not a new Git commit).

## Implemented and Published

| Request | Implementation | Verification |
| --- | --- | --- |
| New-version notifications | Independent settings switch; top-right Update application button | Updater policy tests and component/Playwright checks |
| Automatic application update | One opportunity at startup only; foreground download progress; signed manifest and SHA-256; install and relaunch | Startup, later-version, settings, interruption/retry tests; packed code verified |
| No automatic update during a raid | Live raid checks before download and installation; no queued automatic retry after raid | Policy tests, including raid starting during download |
| Story quests as observed tasks | Main/optional objectives from current screenshot; no future-stage list; separate map links for known objectives | Story parser/sync tests, real screenshot OCR regression, desktop/mobile component checks |
| Mini-map reopen and interaction | Reapply native pointer zones; reshow event; map size invalidation; drag/size/opacity controls | Component and real Leaflet Playwright checks with mocked native IPC |
| Item card near the item | Anchor to original hotkey cursor location, clamp/flip at monitor edges | Seven placement tests and packed code verification |
| Remove obsolete map screenshots safely | Delete only the prior unchanged file proven to be captured by this running app after the next capture is read | Five retention tests; manual/preexisting files preserved |
| Overview redesign preview only | Requirements band moved below summary, above map/tasks in a separate preview | Desktop/mobile screenshots; production Dashboard source unchanged |
| Website Windows download | Direct EXE attachment; signed newest-build manifest | External Windows-side HTTP, signature and executable-header checks |

## Test and Deployment Evidence

- Full suite: 833 passed before final OCR footer refinement.
- Final affected story/application suite: 36 passed after that refinement.
- Browser preview: no runtime errors; screenshots in this folder.
- Both client and owner packages: OCR models/dependencies and Windows native modules present.
- Deployment: 38 scoped source files; concurrent-edit baseline check passed.
- Consistent SQLite backup created; production account database not replaced.
- Signed client publication: direct attachment, range 206 with MZ header, API/database/site healthy.
- Client EXE: 203537167 bytes, SHA-256 f9b126f7159336169bcbabc330786cbb11c7756913826fe24999adb6efcd0eef.
- Public report: public-update.json. Browser report: checks.json. Full suite report: tests.json.

## Still Needs Native Game Verification

- Windows click-through, hotkeys, cursor placement, drag and reopen while EFT is running: native app control unavailable in this session.
- Actual portable EXE replacement/relaunch on Windows: policy/helper invocation tested, real process swap not executed here.
- Story synchronization under 10 seconds on every user's PC is not established. Polling is faster and visible objectives update without waiting for stage confirmation, but OCR cost varies.
- Unknown objectives are displayed without invented map locations; only confirmed catalog matches get map buttons.
- Screenshot cleanup is intentionally not a sweep of existing/manual images.
- This checkpoint is not a complete new security audit or a verification of every historical request in the chat.

## First Installation

Download https://raidos.app/download/windows once to replace a copy with the old updater.
The notification switch and startup automatic-update switch are independent.
No server deployment automation or 15-minute server polling was added or re-enabled.
