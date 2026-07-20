# Daktari Mkononi

Telemedicine platform for Tanzania — patients, doctors, hospitals, and pharmacy
delivery. Swahili-first UX. See [CLAUDE.md](CLAUDE.md) for conventions and
compliance context.

## Prerequisites

- Node.js >= 20, pnpm >= 9
- Docker (for local Postgres + Redis)

## Local development

```bash
# 1. Install dependencies (also generates the Prisma client)
pnpm install

# 2. Configure environment
cp .env.example .env        # then edit secrets — JWT secrets >= 64 chars,
                            # ENCRYPTION_KEY = 64 hex chars, OTP_PEPPER >= 32 chars

# 3. Start Postgres 16 + Redis 7 (with healthchecks and persistent volumes)
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# 4. Apply the schema to the database
pnpm --filter @daktari/db exec prisma migrate dev   # or `db:push` for a quick sync

# 5. Seed realistic Tanzanian test data (idempotent)
pnpm --filter @daktari/db db:seed

# 6. Run the API server
pnpm --filter @daktari/api-server dev               # http://localhost:4000/health
```

Stop the infrastructure with
`docker compose -f infrastructure/docker/docker-compose.dev.yml down`
(add `-v` to also drop the data volumes).

### Without Docker (portable PostgreSQL)

On machines without Docker/WSL, the official portable PostgreSQL binaries work
just as well (this is how CI-less local dev runs on Windows here):

```powershell
# 1. Download and extract the binaries-only zip (no installer, no admin rights)
#    https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64-binaries.zip
tar -xf postgresql-16.4-1-windows-x64-binaries.zip -C <dir>

# 2. Initialize a cluster with the same credentials the compose file uses
Set-Content pgpass.txt 'daktari' -Encoding ascii -NoNewline
<dir>\pgsql\bin\initdb -D <dir>\pgdata -U daktari --pwfile=pgpass.txt -E UTF8 -A scram-sha-256 --no-locale

# 3. Start it on the same port DATABASE_URL expects, and create the databases
<dir>\pgsql\bin\pg_ctl -D <dir>\pgdata -l pg.log -o "-p 5432" -w start
<dir>\pgsql\bin\createdb -h localhost -U daktari daktari_mkononi
<dir>\pgsql\bin\createdb -h localhost -U daktari daktari_test   # for integration tests

# Stop with: <dir>\pgsql\bin\pg_ctl -D <dir>\pgdata stop
```

Redis is only needed for the distributed rate-limit store and queues; the API
server falls back to in-memory stores when `redis` is not wired, so the test
suites do not require it.

To run the gated integration tests (PowerShell syntax):

```powershell
$env:TEST_DATABASE_URL = 'postgresql://daktari:daktari@localhost:5432/daktari_test'
pnpm --filter @daktari/db exec prisma db push   # with DATABASE_URL pointed at daktari_test
pnpm test
```

## Workspace commands

| Command          | What it does                             |
| ---------------- | ---------------------------------------- |
| `pnpm build`     | Build all packages (turbo)               |
| `pnpm typecheck` | TypeScript strict checks, all packages   |
| `pnpm lint`      | ESLint, zero warnings tolerated          |
| `pnpm test`      | Vitest suites across the workspace       |

Integration tests for the API server only run when `TEST_DATABASE_URL` points
at a migrated Postgres database (they are skipped otherwise, with a notice).

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

```bash
# The phone can't reach 'localhost' — use your machine's LAN IP.
# Create apps/mobile/.env with your laptop's address on the Wi-Fi:
#   EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
cd apps/mobile
npx expo start --dev-client -c   # -c clears the cache (required after this phase)
```

Open the installed **Daktari Mkononi dev build** on the phone (not Expo Go) and
it connects to the Metro bundler over the LAN. Video/audio calls need the dev
build; the rest of the app also runs there.

**LAN / API base URL gotcha.** `EXPO_PUBLIC_API_URL` must be the laptop's
Wi-Fi IP (`ipconfig` → IPv4), not `localhost`/`127.0.0.1`. The laptop and phone
must be on the same network, and the laptop firewall must allow inbound TCP on
port 4000 (API) and 8081 (Metro). Native `fetch`/`WebSocket` are not subject to
browser CORS, so no server CORS change is needed for the phone — but the API
server's CORS `origin` still gates any web client.

**iOS note.** An iOS development build additionally needs a paid Apple Developer
account for device provisioning (`eas build --profile development --platform
ios`); Android internal-distribution APKs have no such requirement, so Android
is the primary target here.
