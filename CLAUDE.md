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
- **Emergency numbers:** guidance strings use **112** (universal emergency) and
  **115** (ambulance). Never 999, 911, or 114.
- **Payments:** Tanzania mobile money via an aggregator (AzamPay-style API).
  Currency is **TZS only** — integer amounts, no decimal cents. Never use
  Safaricom Kenya Daraja endpoints; Tanzania M-Pesa (Vodacom TZ) goes through
  the aggregator.

## Stack

- Turborepo + pnpm workspaces (`apps/*`, `packages/*`, `services/*`)
- TypeScript strict everywhere — `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`; **no `any`** (lint error)
- Zod validates **all** external input (HTTP bodies, env, webhooks, queue
  payloads); shared schemas live in `packages/schemas`
- Prisma + PostgreSQL (`packages/db`), Redis for cache/queues
- Fastify API (`services/*`), Next.js 15 web, Expo mobile (later phases)
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
- All money fields are named `*Tzs` and stored as integers.
- Phone numbers are normalized to `+255XXXXXXXXX` at the schema layer.
- IDs are CUIDs (Prisma `@default(cuid())`); schemas accept CUID or UUID.

## Commands

- `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` — turbo pipelines
- `pnpm --filter @daktari/db db:generate` — regenerate Prisma client
- `pnpm --filter @daktari/db db:seed` — seed realistic Tanzanian test data
