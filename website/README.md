# Tarkov Operations Companion — website

Russian-language product site and personal account (личный кабинет) with the same dark olive/brass look as the
desktop app. React + react-router (BrowserRouter) + Vite. It has no `node_modules` of its own: every command
below runs **from the repository root** and uses the root `node_modules`. Do not run `npm install` inside `website/`.

Pages: `/` (главная, трейлер, возможности), `/download`, `/login`, `/register`, `/cabinet`, `/r/<code>` (реферальная ссылка).

## Run, check, build

```bash
# from the repository root
npx vite --config website/vite.config.ts --port 5202        # dev server → http://localhost:5202
npx tsc --noEmit -p website/tsconfig.json                    # type-check
npx vite build --config website/vite.config.ts               # production build → website/dist
npx vite preview --config website/vite.config.ts --port 5202 # serve the build locally
```

(`website/package.json` has the same commands as `npm --prefix website run dev|build|typecheck|preview`.)

Hosting: `website/dist` is a static SPA with real paths (`/cabinet`, `/r/<code>`), so the host must rewrite
unknown paths to `/index.html` (Netlify `_redirects`, Nginx `try_files $uri /index.html`, etc.).

## Environment variables

Build-time Vite variables. Put them in `website/.env.local` (git-ignored); see `website/.env.example`.

| Variable            | Default                  | Meaning |
|---------------------|--------------------------|---------|
| `VITE_API_URL`      | `http://localhost:8787`  | Base URL of the API in `server/` (accounts are under `/v1/accounts`). |
| `VITE_DOWNLOAD_URL` | `#`                      | Public URL of the Windows portable exe. With `#` the download button is inactive and the page says the link will appear soon. |

## Running the account API

The API lives in `server/` (`createAccountsRouter` in `server/src/routes/accounts.ts`, mounted at `/v1/accounts`).

```bash
npm --prefix server ci          # once
WEB_ORIGIN=http://localhost:5202 npm --prefix server run dev
```

`WEB_ORIGIN` must be the website origin, otherwise the browser blocks requests by CORS (the server default
is `http://localhost:5173`, the desktop renderer). If the API is unreachable the site shows a friendly
"Сервер аккаунтов сейчас недоступен" message instead of failing.

Endpoints: `POST /register`, `POST /login`, `POST /logout`, `GET /me`, `POST /me/referral`, `PUT /me/nicknames`,
`POST /referral-visits`. Login/registration are rate-limited per IP (10 per 15 minutes by default).

## Accounts, streamers and referral links

- Everyone uses the **same** login and registration forms and the same cabinet layout.
- Account kinds: `user` (обычный пользователь) and `streamer`. A streamer additionally sees the
  «Реферальная программа» section (code, link with a copy button, переходы / регистрации / активные подписки /
  начисления from `GET /me`). A user sees subscription status, nicknames per mode (PvP / PvE / Сезон), the app
  download and a field to enter a streamer's code once.
- Visiting `/r/<code>` stores the code in `localStorage` (`toc.referral`), counts a visit on the server
  and shows the landing; the registration form sends the code. Referral users get a 3-day trial (server-side).

### Promoting a streamer

Streamer status is **never** self-selected and there is intentionally no HTTP endpoint for it. An operator
calls `promoteToStreamer(email, code)` on the `AccountStore` instance used by the API, for example in a
one-off operator hook in the server process:

```ts
import { AccountStore } from './services/accountStore.js'

const accounts = new AccountStore()
// … after the streamer registered on the site:
accounts.promoteToStreamer('streamer@example.com', 'HUNTER_TV') // code: 3–24 chars, A–Z 0–9 _ -, unique
```

Because the prototype store is in memory, promotion must happen in the same running process (and is lost on
restart). Once a persistent database exists this becomes an admin CLI/script that updates the account row.

## Trailer

`src/components/Trailer.tsx` plays `/media/trailer.mp4`. **The real trailer file is not in the repository** —
add it as `website/public/media/trailer.mp4` (or point `TRAILER_SRC` at a CDN). Until then the poster
`public/media/trailer-poster.svg` is shown and pressing play shows a "trailer coming soon" note.

## Not implemented yet (prototype limits)

- Persistent database: accounts, sessions, referral visits live in server memory and vanish on restart.
- E-mail verification, password reset, account deletion, 2FA.
- Payments / subscriptions: status is `trial` (3 days after a referral) or `inactive`; `activeSubscriptions` and
  `earnings` are always 0 until payment-provider webhooks exist. Payout requests are not implemented.
- Admin UI for streamers (promotion is a server-side function call only).
- The desktop app does not log in with these accounts yet.
- English version of the site.
