# raidos.app site

Static landing page for Tarkov Operations Companion, served on `raidos.app`
by Cloudflare Workers (static assets, no server code).

- `public/` — files served as-is (`index.html`, `404.html`, `_headers`).
- `wrangler.jsonc` — Worker `raidos-site`, custom domains `raidos.app` and `www.raidos.app`.

Deploy manually: `cd site && npx wrangler login && npx wrangler deploy`.
Automatic deploys: Cloudflare Workers Builds connected to this repository with
root directory `site` and deploy command `npx wrangler deploy`.

The site makes no claims beyond what the desktop app actually does
(no live inventory, no in-raid position reading, no game injection).
