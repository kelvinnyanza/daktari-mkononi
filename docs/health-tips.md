# Health tips — "Vidokezo vya Afya"

Public health-education content shown in the patient app (Home carousel, tip
pages, "Vidokezo vyote"). Never PHI. Model: `HealthTip`
(`packages/db/prisma/schema.prisma`, migration `4_health_tips`).

## Lifecycle

```
DRAFT ──review──▶ REVIEWED ──publish──▶ PUBLISHED ──archive──▶ ARCHIVED
  ▲                  │ (edit text)          │ (edit text)          │
  └──────────────────┴──────────────────────┘◀──────restore─────────┘
```

- **Review** — a **verified doctor** (DOCTOR with verification APPROVED) or a
  content admin (`content:review`). The doctor's name is shown in the app as
  "Imehakikiwa na Dkt. …".
- **Publish** — a content admin (`content:manage`), and only a REVIEWED tip.
- Editing the **text** (title, summary, article, takeaways, sources, category)
  of a REVIEWED or PUBLISHED tip sends it back to **DRAFT**: it disappears
  from the app until it is reviewed and published again. Priority and the
  publish window can change without re-review.
- Every change is written to `AuditLog` (`HEALTH_TIP_*`, with from/to status).

## How to publish a tip

1. Admin portal → **Health tips / Vidokezo vya Afya** → open a draft (or **New tip**).
2. Edit Swahili and English side by side; check the preview on the right
   (it uses the same renderer as the app). **Save**.
3. A verified doctor opens **Doctor portal → Review health tips**, reads both
   languages and presses **Mark reviewed** (an admin with the content role
   may also review).
4. Back in the admin editor, press **Publish**. Optionally set *Publish from* /
   *Unpublish at* and a *Priority* (higher shows first; the top 3 are always
   in the Home carousel, the rest rotate daily).
5. Patients see it on the next refresh (the app re-checks with ETag/304, so
   unchanged lists cost almost nothing to re-check).

## Article format

Plain text only — no HTML, no links inside the article:

```
## Heading
A paragraph. Lines next to each other join into one paragraph.

- a bullet
- another bullet
```

Every tip must say **when to see a health worker**, and point to **112/115**
for danger signs. No diagnosis, no medicine names with doses, no miracle
claims. Sources: https links (WHO fact sheets, Ministry of Health).

## Seed content

`packages/db/prisma/seed-data/health-tips/` holds 110 bilingual drafts
(8 categories), written from WHO fact sheets and Tanzania MoH guidance.
`pnpm --filter @daktari/db db:seed` creates the ones that don't exist yet —
**always as DRAFT, never published, never overwriting an edited tip**.
`services/api-server/tests/health-tip-content.test.ts` checks every draft
against the API schema and the rules above.

## Illustrations

12 unDraw illustrations (https://undraw.co — free for commercial use, no
attribution), recoloured: accent → brand teal `#0F7366`, secondary → mint,
light skin tones → brown. Keys: `HEALTH_TIP_ILLUSTRATIONS` in
`@daktari/schemas`.

```
pnpm --filter @daktari/mobile illustrations          # rebuild PNGs/SVGs from src/
pnpm --filter @daktari/mobile illustrations --fetch  # re-download from unDraw first
```

Outputs: `apps/mobile/assets/illustrations/<key>.png` (+@2x/@3x) for the app,
`apps/web/public/illustrations/<key>.svg` for the portal. To add one: add the
key + unDraw id to `scripts/illustrations.mjs`, the key to
`HEALTH_TIP_ILLUSTRATIONS`, the `require` to `src/features/tips/TipArt.tsx`.

An uploaded image (jpg/png/webp, ≤ 1 MB) replaces the illustration for one
tip. No photos of real people without their consent.

## Dev preview

Dev builds ask the API for drafts (`preview=drafts`) and badge them
**RASIMU** in the app. The API ignores that flag in production, and release
builds never send it.
