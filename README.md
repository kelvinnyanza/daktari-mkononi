# Daktari Mkononi

Telemedicine platform for Tanzania — patients, doctors, hospitals, and pharmacy
delivery. Swahili-first UX. See [CLAUDE.md](CLAUDE.md) for conventions and
compliance context.

## Quickstart

Prerequisites: **Node.js >= 20** and **pnpm >= 9**. Nothing else — no Docker, no
WSL, no admin rights. PostgreSQL is downloaded as portable binaries into
`.local/` inside this checkout and started on demand.

```powershell
git clone <repo> && cd daktari-mkononi

pnpm install       # dependencies + Prisma client
pnpm dev:setup     # writes .env with freshly generated secrets (idempotent)
pnpm db:start      # installs PostgreSQL 16 on first run, starts it, creates the databases
pnpm db:push       # apply the Prisma schema
pnpm db:seed       # seed realistic Tanzanian test data
pnpm dev:doctor    # verify all of the above
```

`pnpm dev:doctor` should print all-PASS:

```
Daktari Mkononi — dev environment check

  [PASS] node >= 20 (found v24.15.0)
  [PASS] pnpm >= 9 (found 9.15.9)
  [PASS] .env present — .env
  [PASS] required env vars valid — validated against @daktari/config schema
  [PASS] PostgreSQL reachable — localhost:5432
  [PASS] schema pushed — "User" table queryable
  [PASS] seed data present — 9 users

All 7 checks passed.
```

Then run the servers, each in its own terminal:

```powershell
pnpm --filter @daktari/api-server dev    # http://localhost:4000/health
pnpm --filter @daktari/web dev           # http://localhost:3000
```

Check the API is up:

```powershell
curl http://localhost:4000/health          # {"status":"ok"}
curl http://localhost:4000/health/ready    # database "ok", redis "skipped" (no Redis in dev)
```

### Seeded logins

Every seeded account shares the password **`Daktari123!`**. Sign in to the web
portal at <http://localhost:3000> with a doctor or the admin; patients use the
mobile app.

| Role | Phone | Name | Notes |
| --- | --- | --- | --- |
| Platform admin | `+255713000000` | Asha Mkapa | Portal: verification, payments, AI usage |
| Doctor | `+255712000001` | Dkt. Amani Mwakasege | General practice, APPROVED |
| Doctor | `+255712000002` | Dkt. Neema Shirima | Paediatrics, APPROVED |
| Doctor | `+255712000003` | Dkt. Baraka Kileo | Cardiology, APPROVED |
| Doctor | `+255712000004` | Dkt. Zainabu Mnyika | Obstetrics & gynaecology, APPROVED |
| Patient | `+255754000001` | Juma Rashidi Mwinyi | Mobile app |
| Patient | `+255754000002` | Fatuma Hassani Kombo | Mobile app |
| Patient | `+255754000003` | Elia Msigwa Sanga | Mobile app |
| Patient | `+255754000004` | Rehema Petro Mollel | Mobile app |

For the full pilot walkthrough — admin verifies a doctor, doctor sets a
schedule, patient books on mobile, doctor conducts the consultation in the
portal — follow [`docs/pilot-runbook.md`](docs/pilot-runbook.md).

## What runs without provider keys

`pnpm dev:setup` leaves every external provider blank, and blank selects a local
fake. You can develop the whole product this way.

| Capability | Unset behaviour | To use the real thing |
| --- | --- | --- |
| SMS / OTP | `ConsoleSms` — **OTP codes print to the API console.** That is how you sign in locally. | `SMS_API_KEY` |
| Payments | `FakePayments`; flip a booking to paid with `POST /api/v1/dev/payments/:appointmentId/complete` (dev-only route) | `AZAMPAY_*` |
| Video | `FakeVideo` — rooms and tokens are stubs, no real call is placed | `DAILY_CO_API_KEY` |
| Document storage | Local disk under `STORAGE_ROOT` (`.storage`) | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |
| Rate limiting | In-memory (single process); `/health/ready` reports redis `skipped` | `REDIS_URL` |
| **AI screening** | **503 `AI_NOT_CONFIGURED`** — deliberately *not* faked | `ANTHROPIC_API_KEY` |

AI screening is the one capability with no fake. A stub that answers medical
triage plausibly is more dangerous than one that is plainly unavailable, so the
endpoints refuse rather than invent. Everything else in the app works without it.

Production is the mirror image: `assertProductionReady` refuses to boot if any
of these are unset, so a fake adapter can never reach real patients.

### Environment

There is **one** `.env`, at the repo root. The API server, the web app, and the
Prisma commands all load it explicitly by path, so they behave the same whether
you run them from the root or from inside a package.

Only these must be set — `pnpm dev:setup` generates them:

`NODE_ENV`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`ENCRYPTION_KEY`, `OTP_PEPPER`, `FILE_SIGNING_SECRET`

> Changing `ENCRYPTION_KEY` makes every previously encrypted row
> undecryptable. Treat it as permanent for a given database.

## Database commands

| Command | What it does |
| --- | --- |
| `pnpm db:start` | Install (first run only), start PostgreSQL, create `daktari_dev` + `daktari_test` |
| `pnpm db:stop` | Stop the server |
| `pnpm db:status` | Print paths, port, running state, databases |
| `pnpm db:reset` | Drop and recreate both databases (then `db:push` + `db:seed`) |
| `pnpm db:push` | Apply the Prisma schema |
| `pnpm db:seed` | Seed Tanzanian test data (idempotent) |

Binaries live in `.local/pg16`, data in `.local/pgdata`, log at `.local/pg.log`
— all gitignored. To start completely over, stop the server and delete
`.local/`.

## Workspace commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Build all packages (turbo) |
| `pnpm typecheck` | TypeScript strict checks, all packages |
| `pnpm lint` | ESLint, zero warnings tolerated |
| `pnpm test` | Vitest/Jest suites across the workspace |

The API server's integration tests only run when `TEST_DATABASE_URL` points at a
migrated database (they are skipped otherwise, with a notice):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://daktari:daktari@localhost:5432/daktari_test'
pnpm test
```

`pnpm db:start` creates `daktari_test` for you. Push the schema into it once:

```powershell
$env:DATABASE_URL = 'postgresql://daktari:daktari@localhost:5432/daktari_test'
pnpm db:push
```

## Running the mobile app (`apps/mobile`)

> **Expo Go no longer works as of Phase 10.** The app now bundles native modules
> (the Daily.co video SDK + WebRTC) that Expo Go cannot load. You must build a
> **development build** — a custom native binary that still hot-reloads your JS
> like Expo Go did. This machine has no local Android SDK, so build in the cloud
> with EAS.

**One-time: build a development client (cloud, EAS).**

```bash
cd apps/mobile
npm install -g eas-cli          # or: pnpm dlx eas-cli@latest <cmd>
eas login                       # your Expo account
eas build --profile development --platform android
# Wait for the cloud build, then download and install the APK it produces
# onto the phone (open the build URL on the device, or `adb install <apk>`).
```

**Each dev session: point the app at your machine and start the bundler.**

```powershell
# The phone can't reach 'localhost' — use your machine's LAN IP.
ipconfig    # copy the IPv4 address of your Wi-Fi adapter, e.g. 192.168.0.100

# Create apps/mobile/.env with that address:
#   EXPO_PUBLIC_API_URL=http://192.168.0.100:4000
cd apps/mobile
npx expo start --dev-client -c   # -c clears the cache
```

Open the installed **Daktari Mkononi dev build** on the phone (not Expo Go) and
it connects to the Metro bundler over the LAN.

**LAN gotchas.** `EXPO_PUBLIC_API_URL` must be the laptop's Wi-Fi IP, not
`localhost`. There is no fallback: if it is missing or not an `http(s)://` URL
the app shows a bilingual "app is misconfigured" screen instead of starting. Phone and laptop must be on the same network, and the laptop
firewall must allow inbound TCP on **4000** (API) and **8081** (Metro). The API
already listens on `0.0.0.0`, so it is reachable over the LAN. Native
`fetch`/`WebSocket` are not subject to browser CORS, so no server CORS change is
needed for the phone — but the API's CORS `origin` still gates web clients.

**iOS note.** An iOS development build additionally needs a paid Apple Developer
account for device provisioning; Android internal-distribution APKs have no such
requirement, so Android is the primary target here.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `pnpm dev:doctor` says `.env` missing | `pnpm dev:setup` |
| `Environment variable not found: DATABASE_URL` | `.env` is missing or `DATABASE_URL` is blank — re-run `pnpm dev:setup` after deleting `.env` |
| `pnpm db:start` fails to bind | Something else holds port 5432 — `pnpm db:status`, or stop the other server |
| `db:push` says the database does not exist | `pnpm db:start` (it creates both databases) |
| Login says the OTP is wrong | The code prints in the **API server console** (ConsoleSms), not by SMS |
| Screening returns 503 `AI_NOT_CONFIGURED` | Expected without `ANTHROPIC_API_KEY`; everything else works |
| Portal signs you out on reload | Expected only if the refresh cookie is gone; the access token is memory-only by design |
