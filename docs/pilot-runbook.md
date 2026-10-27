# Pilot runbook — one consultation, end to end

This is the full loop the pilot depends on: **an admin verifies a doctor → the
doctor sets a schedule → a patient books and pays on the mobile app → the
doctor conducts the consultation in the web portal → completes it → the patient
rates it.** Every step below is a real user action in a real UI; nothing here
needs `curl`.

If you are driving the doctor side *without* the portal (scripted, for debugging
a single API call), the older harness still exists at
[`dev-doctor-flow.md`](./dev-doctor-flow.md).

**Development instructions against a local stack. Do not run against production.**

---

## Before the smoke test (device checklist)

Do these once, in order, before handing a phone to anyone.

**1. Keys in the root `.env`.** Blank means "local fake" — fine for a dry run,
but the real device test needs:

| Key | Needed for | If blank |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Swahili AI screening | Screening answers 503 `AI_NOT_CONFIGURED` (deliberate — no fake triage) |
| `DAILY_CO_API_KEY` | Real video/audio calls | `FakeVideo` — the call screen opens but never connects |
| `AZAMPAY_*` | Real mobile-money payments | `FakePayments` — use the dev flip in step 3 below (fine for the smoke test) |
| `SMS_API_KEY` | Real OTP SMS | `ConsoleSms` — the OTP prints in the API terminal (fine for the smoke test) |

**2. Start Postgres, the API and the web portal** (three terminals, repo root):

```powershell
# Terminal 1 — database (portable Postgres in .local/pg16; no Docker)
pnpm db:start        # starts it; creates daktari_dev + daktari_test if missing
pnpm db:push         # schema → daktari_dev
pnpm db:seed         # seeded admin + 4 APPROVED doctors (see README "Seeded logins")
pnpm dev:doctor      # environment self-check: every line should PASS

# Terminal 2 — API on 0.0.0.0:4000 (reachable over the LAN)
pnpm --filter @daktari/api-server dev

# Terminal 3 — web portal on http://localhost:3000 (doctor + admin use it on the PC)
pnpm --filter @daktari/web dev
```

**3. Run the preflight** (with the API running):

```powershell
pnpm smoke:check
```

It lists which provider keys are set (never their values), checks `/health`
and `/health/ready`, sends one tiny Anthropic request if that key is set, and
creates + deletes a test Daily room if that key is set. Everything you need
must say `PASS` before going further.

**4. Build the EAS development build** (once per native change — not per IP
change). Expo Go cannot run this app (native Daily/WebRTC modules).

```powershell
cd apps/mobile
pnpm dlx eas-cli@latest login
pnpm dlx eas-cli@latest build --profile development --platform android
```

When the cloud build finishes, open its URL on the phone and install the APK.

**5. Point the phone at the PC's LAN IP.**

```powershell
ipconfig     # IPv4 address of the Wi-Fi adapter, e.g. 192.168.0.100
```

- Put `EXPO_PUBLIC_API_URL=http://<that IP>:4000` in `apps/mobile/.env`. If it
  is missing or not an `http(s)://` URL, the app shows a bilingual "app is
  misconfigured" screen — there is no localhost fallback.
- Phone and PC on the **same Wi-Fi** (not a guest network that isolates
  clients).
- Windows Firewall must allow inbound TCP **4000** (API) and **8081** (Metro).
  When Windows asks whether to allow Node.js on private networks, say **Allow**.
- Check from the phone's browser: `http://<that IP>:4000/health` must show
  `{"status":"ok"}`.
- Start Metro and open the dev build on the phone (it connects to Metro, which
  serves the JS with the URL baked in):

```powershell
cd apps/mobile
npx expo start --dev-client -c
```

The IP is read when Metro bundles, so after an IP change edit
`apps/mobile/.env` and restart Metro with `-c`; no rebuild needed.

---

## 0. Bring the stack up

Same commands as checklist step 2 above: `pnpm db:start`, `pnpm db:push`,
`pnpm db:seed`, then the API and the web portal in their own terminals.

For the phone to reach the API, both must be on the same Wi-Fi and the mobile
app's `EXPO_PUBLIC_API_URL` must point at your machine's LAN IP (not
`localhost`). The portal reads `NEXT_PUBLIC_API_URL`, default
`http://localhost:4000`.

> The API must run as a **single instance**: real-time chat and presence use
> the in-memory pub/sub, so events do not cross processes yet.

### Accounts you need

| Role | Where it comes from |
| --- | --- |
| Platform admin | Seeded (`PLATFORM_ADMIN`). Signs in at the portal. |
| Doctor | **The portal has no doctor registration yet** (planned). For the smoke test use a seeded doctor — `pnpm db:seed` creates four, already `APPROVED` (README "Seeded logins"), so step 1 can be skipped. To exercise verification itself, register a doctor via the API (`POST /api/v1/doctors/register`) and upload documents (`POST /api/v1/doctors/me/documents`); [`dev-doctor-flow.md`](./dev-doctor-flow.md) has the scripted doctor-side calls. (`pnpm dev:doctor` is the environment self-check, not a doctor-creation script.) |
| Patient | Register in the mobile app (real OTP flow; the dev SMS adapter prints the code to the API console). |

---

## 1. Admin verifies the doctor

1. Open <http://localhost:3000> and sign in as the platform admin.
   You land on **Doctor verification**.
2. The doctor must have submitted documents first — their status shows
   `DOCUMENTS_SUBMITTED`. If the queue is empty, the doctor has not uploaded
   anything yet (`POST /api/v1/doctors/me/documents`).
3. Press **Claim for review**. This is the concurrency guard: a second admin
   now sees "Under review by another admin" and cannot decide.
4. Press **Open review**.
5. **Check the TMC number first.** It is displayed large at the top with a
   "Verify on the TMC register" link that opens the Tanzania Medical Council
   register in a new tab. Confirm the registration number belongs to this
   person before anything else.
6. Click each document filename to open it in the viewer (signed URLs, valid
   15 minutes) and press **Approve document** or **Reject document** per file.
   `tmc_cert`, `degree` and `id` are required; `police_clearance` is optional.
7. Press **Approve doctor**.
   - The button stays disabled until every required document is approved and
     you hold the claim — the panel tells you which rule is blocking.
   - To reject instead, write a reason of at least 10 characters (it is sent to
     the doctor) and press **Reject application**.

**Verify:** the doctor now appears under **Doctors** with status `APPROVED`, and
they are visible in the patient app's doctor directory (which lists APPROVED
doctors only).

---

## 2. Doctor sets their weekly schedule

1. Sign out, then sign in as the doctor. You land on **Today**.
2. Go to **Schedule**.
3. Tick the days you work and set start/end times. **All times are EAT
   (UTC+3)** — what you type is the wall clock in Dar es Salaam.
4. Add a lunch break if you want (it must sit inside the working window).
5. Set the slot length (10–120 minutes) and press **Save**.

**Verify:** `GET /api/v1/doctors/:id/availability?date=YYYY-MM-DD` for a day you
enabled returns slots. Remember the availability window for date *D* covers UTC
`[D-1 21:00, D 21:00)` — a 23:00 EAT slot is stored as 20:00 UTC on the same
calendar day.

---

## 3. Patient books and pays (mobile)

1. In the mobile app, register a patient and verify the OTP (the code prints to
   the API console in development).
2. Optionally run the **Swahili AI screening** first — if you book from the
   screening result, the transcript is linked to the appointment and the doctor
   will see it in step 4.
3. Pick the doctor, pick a slot on a day you enabled, book.
4. Pay with mobile money. In development, no real money moves — flip the
   payment with the dev-only endpoint:

```powershell
# Dev only. This route is NOT registered when NODE_ENV=production
# (asserted in tests/production-guard.test.ts).
Invoke-RestMethod -Method Post `
  -Uri "http://localhost:4000/api/v1/dev/payments/$APPOINTMENT_ID/complete" `
  -Headers @{ Authorization = "Bearer $PATIENT_TOKEN" }
```

It drives exactly the same `applyPaymentResult` path the aggregator webhook
uses, so the state transition and the doctor's earnings accrual are identical
to production.

**Verify:** the appointment is `CONFIRMED` and the payment is `COMPLETED` under
the portal's **Payments** screen.

---

## 4. Doctor conducts the consultation (portal)

1. As the doctor, open **Today**. The booking appears at its EAT time with a
   `CONFIRMED` chip.
2. For an in-person appointment, the patient shows their check-in token; paste
   it into the check-in box and press **Check in**. Remote (video/audio/chat)
   appointments start directly.
3. Press **Start consultation**. You land in the consultation workspace.

The workspace has three columns:

- **Left — patient context.** Age *band* (never the date of birth), gender,
  blood type, chronic conditions, allergies, current medications, and the
  decrypted AI screening transcript with its triage level. Every open of this
  panel writes an `AuditLog` PHI-read row.
- **Centre — clinical notes.** Five fields: chief complaint, history of
  presenting illness, examination, assessment, plan. They **autosave** about a
  second after you stop typing; the header shows "Saving…" / "All changes
  saved". Only the fields you changed are sent, and a failed save retries by
  itself. Below them, add diagnoses by ICD-10 code (`B50.9` style) — exactly
  one may be PRIMARY.
- **Right — video and chat.** Press **Join video** for Daily's prebuilt call UI.
  Chat runs over the WebSocket; the header shows whether the patient is online.

4. Write at least an **assessment** and a **plan**. **Complete consultation**
   stays disabled until both exist — the server enforces the same rule.
5. Press **Complete consultation**. Pending autosaves are flushed first, so
   nothing you typed in the last second is lost.

If something goes wrong (patient drops off, wrong patient), use **End without
completing** with a reason. The appointment can be restarted **once**; a second
abort closes it for good.

**Verify:**
- The appointment is `COMPLETED`.
- An immutable `MedicalRecord` exists with the encrypted notes.
- Under the doctor's **Earnings**, a `PENDING` row appeared for this
  consultation (`consultation:<id>`), for the doctor's share of the fee.
  Payout execution is a later phase — `PENDING` means owed, not failed.

---

## 5. Patient rates the consultation (mobile)

1. In the mobile app, the completed appointment offers a rate action.
2. Submit a rating and a comment.

**Verify:** the doctor's `averageRating` and `totalConsultations` update on the
portal's **Doctors** list. A patient can rate a consultation exactly once.

---

## Where to look when a step fails

| Symptom | Likely cause |
| --- | --- |
| Queue is empty | Doctor has not uploaded documents (`DOCUMENTS_SUBMITTED`). |
| "Approve doctor" stays disabled | A required document is unapproved, or you did not claim the review. |
| No slots for a date | Schedule day disabled, or you are looking at a UTC date instead of the EAT one. |
| Booking returns 409 `SLOT_TAKEN` | The partial unique index did its job — the slot really was taken. |
| Payment stuck `PROCESSING` | The dev flip was not run, or it was run against the wrong appointment. |
| "Start consultation" missing | The appointment is not `CONFIRMED`/`CHECKED_IN`. |
| Chat shows "Disconnected" | The WS ticket expired (30 s, single use) — it reconnects on its own; if it does not, the API restarted. |
| Presence never shows the patient | The API is running as more than one instance; in-memory pub/sub does not cross processes. |
| "Complete" disabled with notes written | Assessment or plan is under 3 characters. |
| Portal signs you out on reload | Expected only if the refresh cookie is gone; the access token is memory-only by design and is re-fetched silently. |
