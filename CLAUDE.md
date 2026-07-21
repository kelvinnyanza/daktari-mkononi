# Daktari Mkononi — Project Conventions

Telemedicine platform for Tanzania: patients, doctors, hospitals, and pharmacy
delivery. **Swahili-first UX**, English secondary (every user-facing string has a
`sw` variant; `sw` is the default language).

## Product & Compliance

- **Regulatory context:** Tanzania Personal Data Protection Act (PDPA) 2022,
  Tanzania Medical Council (TMC) doctor verification, Ministry of Health
  Telemedicine Guidelines, TMDA (medicines regulation). NHIF integration planned.
- **PHI handling:** all protected health information is encrypted at rest
  (AES-256-GCM, key from `ENCRYPTION_KEY` env — 32 bytes hex). Every access to
  PHI must be written to `AuditLog`.
- **Encryption payload format v1** (`@daktari/encryption`): JSON
  `{ "v": 1, "iv": <hex>, "tag": <hex>, "ct": <hex> }` — random 12-byte IV per
  encryption, 16-byte GCM tag verified on decrypt (`TamperedDataError` on any
  auth failure, never partial plaintext). The `v` field enables key/algorithm
  rotation without rewriting stored rows. Use `encryptHealthData` /
  `decryptHealthData` for PHI; core `encryptAesGcm`/`decryptAesGcm` take an
  explicit key Buffer.
- **Passwords:** argon2id (memoryCost 65536, timeCost 3, parallelism 4) via
  `@daktari/encryption` `hashPassword`/`verifyPassword`. `hash.ts` is env-free
  by design — the db seed imports it standalone.
- **OTP policy:** 6 digits, crypto-uniform (rejection sampling), zero-padded;
  stored as **HMAC-SHA-256(OTP_PEPPER, `userId:purpose:code`)**, verified
  timing-safe. Why HMAC, not plain SHA-256: the 6-digit space is only 10^6
  values, so a leaked OTP table with unkeyed hashes is brute-forced instantly;
  the pepper (env `OTP_PEPPER`, min 32 chars, never stored with the data)
  makes a table leak useless on its own, and the userId+purpose context means
  identical codes hash differently per user/purpose. 5-minute expiry, max 5
  attempts per code, single use.
- **Refresh token rotation:** HS512 JWTs. Every login starts a token family
  (`newTokenFamily`); each refresh rotates the family's active token. A replay
  of an already-rotated token (`evaluateRefreshAttempt` → `REVOKE_FAMILY`,
  `REUSE_DETECTED`) must revoke the entire family + session. Verify always
  pins `{ algorithms: ["HS512"] }` and Zod-validates payload shape; token
  errors are typed EXPIRED / INVALID / MALFORMED.
- **Emergency numbers:** guidance strings use **112** (universal emergency) and
  **115** (ambulance). Never 999, 911, or 114.
- **Payments:** Tanzania mobile money via an aggregator (AzamPay-style API).
  Currency is **TZS only** — integer amounts, no decimal cents. Never use
  Safaricom Kenya Daraja endpoints; Tanzania M-Pesa (Vodacom TZ) goes through
  the aggregator.
- **Money rules (Phase 7):** every money field is **whole TZS as `Int`** —
  never Float, never cents. Fee splits use `splitFee(amountTzs, feePercent)`
  from `@daktari/payments` (integer math; the **platform receives the rounding
  remainder**; invariant `platformFeeTzs + doctorAmountTzs === amountTzs` is
  property-tested). Payment mutations are idempotent: one Payment row per
  appointment, `idempotencyKey = appointmentId:attempt`, guarded status
  transitions so webhook replays/reconciliation can never double-apply.
  Webhooks answer 200 even for unknown references (audited) — never teach the
  provider to retry. Doctor earnings are **accrual-only**: consultation
  COMPLETED creates a PENDING `DoctorPayment` row from `doctorAmountTzs`
  (reference `consultation:<id>`, one per consultation); payout execution
  (bulk disbursement) is a later phase.
- **Time & timezone:** every timestamp is **stored in UTC**; schedules and
  availability are **computed in Africa/Dar_es_Salaam (EAT, UTC+3, no DST)** —
  pure +3h arithmetic, no tz database (`services/api-server/src/lib/eat-time.ts`).
  `DoctorSchedule.startTime`/`endTime`/breaks are HH:mm EAT wall-clock strings;
  `Appointment.scheduledAt` is UTC. A 23:00 EAT slot is 20:00 UTC the same
  calendar day; availability for date D covers UTC [D-1 21:00, D 21:00).
- **Real-time (Phase 5):** WebSocket auth uses short-lived (30s) single-use
  tickets from `POST /api/v1/ws/ticket` — the JWT never goes in a query string.
  Broadcast goes through `PubSubPort`; the current `InMemoryPubSub` is
  **single-instance only** (events do not cross processes). Redis pub/sub
  replaces it behind the same port in Phase 11 — until then the API must run
  as one instance for real-time features.
- **Web portal auth (Phase 11):** browser clients send `x-daktari-client: web`
  (or `client: "web"` in the login body). The access token stays **in memory
  only** (never localStorage/sessionStorage — XSS would read it); the refresh
  token is delivered as a cookie that is `httpOnly` (JS cannot read it),
  `SameSite=Strict`, `Secure` in production, and `Path=/api/v1/auth/refresh`
  so it is attached to nothing else. `/refresh` prefers the cookie and rotates
  it (family reuse detection unchanged); `/logout` clears it; a failed refresh
  clears it so a dead cookie cannot linger. **CSRF reasoning:** the only
  cookie-authenticated endpoint is `/refresh`, and `SameSite=Strict` means a
  cross-site page cannot cause the browser to attach that cookie at all. Every
  *other* endpoint authenticates with the `Authorization: Bearer` header, which
  a cross-site attacker cannot set on a simple form post — so the custom-header
  requirement is itself the second CSRF barrier. That barrier is **enforced, not
  incidental**: `/refresh` presented with the cookie but *without*
  `x-daktari-client: web` is rejected `401 WEB_CLIENT_HEADER_REQUIRED` and never
  falls back to the body, so a cross-site form post cannot spend the cookie even
  if `SameSite` is ever weakened or a browser lets one through. The web client
  therefore sends the header on **every** request, not just login. Consequence:
  no CSRF token table is needed, but `SameSite=Strict` must never be relaxed to
  `Lax`/`None` without introducing one. Mobile behavior is unchanged (refresh
  token in the body → SecureStore, no header, no cookie).
- **Clinical text is never plaintext in the DB:** consultation notes
  (chief complaint, HPI, examination, assessment, plan) live in ONE
  `encryptedNotes` blob, chat messages in `encryptedBody`, medical-record
  detail in `encryptedContent` — all via `encryptHealthData`. Medical records
  are immutable; corrections are new records linked by `addendumToId`.
- **Web portal API access (Phase 11):** the browser calls the API **directly**
  — there is no Next.js server proxy. A proxy cannot hold a per-user in-memory
  access token without inventing a server-side session store (the stateful
  surface the token strategy exists to avoid), and it would duplicate an
  authorization boundary the API already owns. CORS is pinned to `APP_URL` with
  `credentials: true`; `SameSite=Strict` still holds because `app.` and `api.`
  are the same registrable domain (SameSite is site-based, not origin-based).
  Consequence: every portal page below the auth gate is a client component.
- **Notes autosave (portal):** `flush()` is the barrier before COMPLETE — it
  awaits the in-flight save *and* loops until nothing is dirty, so text typed
  during a save still lands before the consultation is completed. A **terminal**
  save failure (409 = consultation left IN_PROGRESS, 403) moves autosave to a
  `stopped` status: no further retries, further keystrokes ignored, unsaved
  fields surfaced by `dirtyFields()` and named in a banner, and COMPLETE
  disabled. Network/5xx stay on the self-healing retry.
  **`flush()` resolving does not mean the notes saved** — on a transient
  failure it returns with fields still dirty. COMPLETE therefore goes only
  through `flushThenComplete()`, which re-checks `status === 'idle'` *and*
  `dirtyFields()` empty and otherwise throws `NotesNotSavedError` without
  sending the request. Completing on unsaved notes is unrecoverable: it closes
  the consultation, writes the **immutable** MedicalRecord and accrues the
  doctor's earnings around text that exists only in that browser.
- **Portal rule mirrors:** verification decisions (`lib/verification-rules.ts`),
  schedule validity (`lib/schedule-rules.ts`) and the completion guard
  (`features/consultation/notes-autosave.ts`) restate server rules **only** to
  explain a disabled button before the click. The server re-enforces every one
  of them; a mirror going stale degrades to a 409, never to an unsafe write.
- **Booking concurrency:** the database is the arbiter — a partial unique index
  `uniq_appointment_active_slot` on Appointment (doctorId, scheduledAt)
  WHERE status NOT IN (CANCELLED, NO_SHOW). Prisma cannot declare partial
  indexes, so `ensureBookingSlotIndex()` (exported by `@daktari/db`) creates it
  at server startup / integration-test setup, after `prisma db push`.

## Stack

- Turborepo + pnpm workspaces (`apps/*`, `packages/*`, `services/*`)
- TypeScript strict everywhere — `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; **no `any`** (lint error)
- Zod validates **all** external input (HTTP bodies, env, webhooks, queue
  payloads); shared schemas live in `packages/schemas`
- Prisma + PostgreSQL (`packages/db`), Redis for cache/queues
- Fastify API (`services/*`), Next.js 15 App Router web portal (`apps/web`),
  Expo mobile (`apps/mobile`)
- **Two React majors on purpose:** `apps/mobile` is React 18 (React Native
  0.76), `apps/web` is React 19 (Next 15). Libraries that ship types importing
  `react` without declaring `@types/react` must be listed under
  `packageExtensions` in `pnpm-workspace.yaml` with a **non-optional**
  `@types/react` peer — otherwise they resolve through pnpm's single hoisted
  copy and leak one major into the other app ("X cannot be used as a JSX
  component"). Do not fix this with tsconfig `paths`: jest-expo turns mobile's
  `paths` into runtime `moduleNameMapper` entries and breaks its test resolver.
- Node >= 20, pnpm >= 9. ESM (`"type": "module"`, NodeNext resolution — relative
  imports need `.js` extensions)

## Conventions

- **Repository pattern** for all DB access — services never call the Prisma
  client directly; repositories live in `packages/db/src/repositories`.
- **Soft deletes** for medical data (`deletedAt` on User, Patient,
  MedicalRecord, Prescription); repositories must filter `deletedAt: null` by
  default.
- **Idempotency keys** on all payment mutations (`Payment.idempotencyKey` is
  unique).
- **Secrets only via validated env** — import `env` from `@daktari/config`;
  never read `process.env` directly outside that package (exception:
  `packages/db` lets Prisma read `DATABASE_URL` itself).
- **Env requirement tiers (dev bootstrap):** only `NODE_ENV`, `DATABASE_URL`,
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`, `OTP_PEPPER` and
  `FILE_SIGNING_SECRET` are required by the schema. **Every provider credential
  is `.optional()`** so a developer boots on fakes; production correctness rests
  entirely on `assertProductionReady`, which must therefore list every one of
  them. Adding a provider means adding it to BOTH. `APP_URL`/`API_URL` default
  to localhost and the guard rejects a localhost value in production. A blank
  value in `.env` is normalized to `undefined` in `loadEnv` — `SMS_API_KEY=`
  means "not configured", and without that normalization `.optional()` would
  reject the empty string.
- **Unset provider ⇒ fake, except AI.** No key selects `FakePayments` /
  `ConsoleSms` / `FakeVideo` / `LocalDiskStorage`, and no `REDIS_URL` means an
  in-memory rate limiter with `/health/ready` reporting redis `skipped`.
  `ANTHROPIC_API_KEY` is the deliberate exception: unset makes screening throw
  503 `AI_NOT_CONFIGURED` (`ScreeningService.requireAi`), because a stub that
  answers medical triage plausibly is more dangerous than one that is plainly
  unavailable.
- **One `.env`, at the repo root**, loaded explicitly by path in every entry
  point (`services/api-server/src/lib/load-env.ts` imported first in
  `server.ts`, `apps/web/next.config.mjs`, `packages/db/prisma.config.ts` and
  `prisma/seed.ts`). Never rely on CWD-relative `dotenv/config`: these commands
  run from inside their own package, where no `.env` exists, and the failure is
  silent.
- **Local Postgres lives in the repo** at `.local/pg16` (binaries) and
  `.local/pgdata` (cluster), managed by `scripts/db.mjs` — no Docker, WSL, or
  admin rights. `pg_ctl` must be spawned with `stdio: 'ignore'`: the server it
  forks inherits an stdout pipe and holds it open, so a piped `spawnSync` never
  returns even though startup succeeded. Readiness is then polled with
  `pg_isready`.
- All money fields are named `*Tzs` and stored as integers.
- Phone numbers are normalized to `+255XXXXXXXXX` at the schema layer.
- IDs are CUIDs (Prisma `@default(cuid())`); schemas accept CUID or UUID.

## Commands

- `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` — turbo pipelines
- `pnpm --filter @daktari/db db:generate` — regenerate Prisma client
- `pnpm --filter @daktari/db db:seed` — seed realistic Tanzanian test data
- Prisma CLI config lives in `packages/db/prisma.config.ts` (not
  `package.json#prisma`); it loads `.env` via dotenv explicitly.
