# Hybrid pilot 0.3.0

Running the API and the website on the owner's PC (accounts, per-user data, streamer promotion, backups):
see ../docs/local-server.md and ../scripts/start-local.ps1. Everything persists in one SQLite file
(TARKOV_DB_PATH, default data/companion.sqlite): accounts, sessions, referral stats, goon sightings,
quest events and /v1/me data (Collector, latest position, settings).

Node.js 24 LTS. Run from the repository root:

```
npm ci
npm --prefix server ci
npm --prefix server start
```

The service listens on 127.0.0.1:8787. No external server is deployed by this change.
SQLite data is saved under server/data when started using npm --prefix server.

Endpoints and payloads are documented in openapi.yaml. The shared catalogue model
is src/domain/types.ts. Both server and standalone client use src/data/catalogSource.ts.
Catalog updates are cached for 60 seconds and concurrent requests share one upstream fetch.
If refresh fails, the last snapshot is returned with source=cache.

Desktop configuration (environment variables inherited at launch):
- TARKOV_API_URL: http://127.0.0.1:8787 for local testing, HTTPS URL for hosting.
- TARKOV_API_TOKEN: same development device token as the service.
- Without a URL, the desktop remains standalone.
- With a configured URL that fails, the catalogue uses its last local cache.
- Renderer code never receives the device token.

Server configuration:
- PORT: 8787 by default.
- HOST: 127.0.0.1 by default. Non-loopback binding requires a token.
- TARKOV_API_TOKEN: required to accept sync batches. Generate a random token locally;
  never use an OpenAI key here.
- TARKOV_DB_PATH: SQLite file path.
- WEB_ORIGIN: browser origin allowed by CORS (default http://localhost:5173).

For the browser UI, VITE_COMPANION_API_URL selects the same catalogue service at build time.
Browser users cannot automatically read local EFT logs; the desktop companion is required.

The pilot sync endpoint is a **single-owner development integration**, not a public login
or subscription system. Events are partitioned by mode/account/character and idempotently
stored. Only normalized quest events leave the desktop; raw logs, inventory and game
credentials are not uploaded. A local event is not cryptographic proof of game progress.
No game process memory is accessed.

schema.sql defines the proposed PostgreSQL model for the hosted stage: users,
subscriptions, device sessions, game profiles/season identity, public snapshots,
quest events, hideout levels, catalog versions and payment webhook receipts.
It has not been applied to a production database. Per-user sessions, subscription
authorization, verified payment webhooks and deployment are still separate work.

Initial server estimate: 2 vCPU / 4 GB RAM / 60 GB SSD for an invitation-only pilot.
Comfortable starting host with PostgreSQL: 4 vCPU / 8 GB RAM / 80–100 GB NVMe,
Ubuntu 24.04 LTS, Node.js 24 LTS, HTTPS reverse proxy, off-server backups.
This is an engineering starting estimate, not a guaranteed concurrent-user capacity.
Measure request latency, RAM and outgoing map traffic before scaling. A GPU is unnecessary.

Verification:
```
npm --prefix server run typecheck
npm --prefix server test
```
