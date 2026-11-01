# How money moves in Daktari Mkononi

_A plain-language guide to the code as it stands on 1 November 2026. Code
references for engineers are at the end._

**In one sentence:** patients pay the full consultation fee by mobile money
through AzamPay; the platform keeps 10% and records the other 90% as money
**owed** to the doctor — but **nothing in the system pays doctors yet**, and
there are a few gaps that must be closed before real money flows.

---

## The whole flow at a glance

```
 PATIENT (tablet/phone)          DAKTARI API                    AZAMPAY / MOBILE NETWORK
 ──────────────────────          ───────────                    ────────────────────────
 1. Books a slot, chooses
    mobile money  ─────────────▶ Appointment = PENDING_PAYMENT
                                 Payment row created = PENDING
                                 (fee split saved: 90% / 10%)
                                 30-minute payment window starts
                                       │
                                       │ "collect TZS X from +255…"
                                       ├──────────────────────────▶ Sends a PIN prompt
                                 Payment = PROCESSING               to the patient's phone
 2. Enters PIN on phone ◀────────────────────────────────────────── (M-Pesa, Tigo Pesa,
                                                                     Airtel Money, Halopesa)
                                       │
                                       │ ◀── result, two ways ────── a) AzamPay calls our
                                       │                               webhook (signed)
                                       │                             b) every minute we ask
                                       │                               AzamPay about payments
                                       │                               stuck > 90 seconds
                                       ▼
            ┌──────────────── success ─┴─ failure ────────────────┐
            ▼                                                     ▼
   Payment = COMPLETED                                   Payment = FAILED
   Appointment = CONFIRMED                               Appointment stays PENDING_PAYMENT
            │                                            → patient can tap "Retry"
            │                                            → after 30 min unpaid:
            │                                              Appointment = CANCELLED
            ▼
 3. Consultation happens (video/audio/chat)
            │
            ▼ doctor clicks "Complete consultation"
   DoctorPayment (earning) created = PENDING   ← "owed to doctor", 90% of fee
            │
            ▼
   ╳  NO PAYOUT STEP EXISTS  ╳   (no code ever pays the doctor or marks PAID)

 Cancellation of a PAID appointment (patient ≥2h before, or doctor any time)
   → automatic full refund request to AzamPay
        success → Payment = REFUNDED, patient gets an SMS
        failure → Payment stays COMPLETED + "refund pending" flag
                  → shows on admin "Refunds pending" list for manual chasing
```

---

## 1. The patient's payment, step by step

1. **Booking.** When the patient books with mobile money, the appointment is
   created as **"waiting for payment"** (`PENDING_PAYMENT`) with a
   **30-minute** deadline, and one payment record is created for it
   (`PENDING`). The fee split is calculated and saved at this moment.
2. **Asking for the money.** The API asks AzamPay to collect the full fee from
   the patient's phone number. The mobile network (worked out from the number's
   prefix: M-Pesa, Tigo Pesa, Airtel Money or Halopesa) pops up a PIN prompt on
   the patient's phone. The payment becomes **`PROCESSING`**. If AzamPay can't
   be reached at booking time, the booking still goes through and the patient
   can retry.
3. **Getting the answer.** The result arrives in one of two ways, and both use
   exactly the same code, so they can never disagree:
   - **AzamPay tells us** by calling our webhook. We only accept the call if
     its digital signature matches our shared secret.
   - **We ask AzamPay.** Every minute, the API checks every payment that has
     been `PROCESSING` for more than 90 seconds.
4. **Success** → payment **`COMPLETED`**, appointment **`CONFIRMED`**. The
   tablet notices within about 5 seconds.
5. **Failure** (wrong PIN, not enough balance, declined) → payment
   **`FAILED`**. The appointment stays "waiting for payment" and the patient
   sees **Retry**, which starts a new attempt (attempt 2, 3, … each with its
   own reference so nothing is ever charged twice by mistake).
6. **Expiry.** If 30 minutes pass without a successful payment, the appointment
   is **cancelled** automatically and the slot is freed. _(See risk #2 — the
   payment record itself is not closed.)_

**Payment statuses:** `PENDING` → `PROCESSING` → `COMPLETED` or `FAILED`
(→ `PROCESSING` again on retry); `COMPLETED` → `REFUNDED` after a refund.

**Protection against double-counting:** one payment record per appointment,
every status change only happens from an expected previous status, so a
repeated webhook or a webhook arriving at the same time as our own check
cannot apply a payment twice. Unknown webhooks are answered "OK" (and logged)
so AzamPay never keeps retrying them.

**Currency:** Tanzanian shillings only, always whole shillings (no cents, no
decimals anywhere).

---

## 2. The split between platform and doctor

- **Who pays what:** the patient pays the doctor's consultation fee in full
  (the fee is set per doctor on their profile).
- **Platform share: 10%**, doctor share: 90%.
- **Where it is set:** a fixed number in the code
  (`DEFAULT_PLATFORM_FEE_PERCENT = 10`). It is **not** an admin setting and not
  per doctor — changing it needs a code change and a new release. Each payment
  stores its own split at booking time, so changing the percentage later does
  not rewrite old payments.
- **Rounding:** the doctor gets their share rounded **down** to the whole
  shilling; the platform gets whatever is left. The two always add up exactly
  to what the patient paid (this is checked by automated tests).

**Worked example — 15,000 TZS consultation:**

| | Calculation | Amount |
|---|---|---|
| Patient pays | | **15,000 TZS** |
| Doctor share | 15,000 × 90% = 13,500 | **13,500 TZS** |
| Platform fee | 15,000 − 13,500 | **1,500 TZS** |

With an uneven fee, e.g. 15,005 TZS: doctor 15,005 × 90% = 13,504.5 → **13,504**;
platform **1,501** (gets the half shilling). Total still 15,005.

Note: AzamPay's own transaction charges are **not** modelled anywhere — the
platform's 10% is calculated on the gross amount as if AzamPay took nothing.

---

## 3. Doctor earnings

- **When an earning is created:** only when the doctor clicks **Complete
  consultation** (with assessment and plan filled), and only if that
  appointment was paid by mobile money (`COMPLETED`). Exactly one earning per
  consultation, for the doctor's 90% share.
- **Statuses that exist:** `PENDING`, `PROCESSING`, `PAID`, `FAILED`.
- **Statuses actually used:** only **`PENDING`** ("owed to the doctor"). No
  code ever moves an earning to `PROCESSING`, `PAID` or `FAILED`.
- **Not earning anything:** consultations that were not paid by mobile money
  (e.g. NHIF or cash — planned, not built), cancelled or no-show appointments,
  and consultations that were interrupted and never completed.

## 4. Doctor payouts

**There is no code that pays doctors.** Specifically, none of these exist:

- AzamPay disbursement / bulk payout calls
- bank transfers
- an admin "mark as paid" button, payout batch, or payout report
- any way to change an earning from `PENDING` to `PAID`

Today the system can tell you **how much each doctor is owed**; actually
paying them would have to be done outside the system, and the system would
keep showing those earnings as `PENDING`. The doctor portal's Earnings page
says "Payouts run separately", which is not backed by anything yet.

## 5. Refunds

- **When they happen (automatically):**
  - the **patient cancels** a paid appointment at least **2 hours** before it
    starts (later than that, patients cannot cancel in the app), or
  - the **doctor cancels** a paid appointment — allowed at any time, reason
    required.
- **How much:** always the **full** amount. There are no partial refunds and
  no cancellation fees.
- **How it reaches the patient:** the API asks AzamPay to send the money back
  to the same mobile money transaction. On success the payment becomes
  `REFUNDED` and the patient receives an SMS (Swahili or English).
- **If AzamPay refuses or is unreachable:** the cancellation still goes
  through; the payment stays `COMPLETED` with a **"refund pending"** flag and
  appears on the admin **Refunds pending** list. An admin can only write down
  what they did to chase it ("Record chase"); there is **no retry button** and
  no way to mark the refund as done once it is settled by hand.
- **Who can trigger a refund:** nobody directly — refunds only happen as a side
  effect of a cancellation. Admins cannot issue a refund (or a partial one)
  from the portal.
- **Effect on doctor earnings:** none needed in the normal case, because an
  earning only exists after the consultation is completed, and a completed
  appointment can no longer be cancelled. But there is **no mechanism** to
  reverse or reduce an earning if money is ever returned after a completed
  consultation (e.g. a complaint).

## 6. What admins and doctors can see

| Who | Where | What |
|---|---|---|
| Admin | Portal → **Payments** | Every payment attempt, newest first; filter by status and date range; amount, platform fee and doctor amount per payment; method; references. **No totals** (no revenue sum, no platform-fee sum). |
| Admin | Portal → Payments → **Refunds pending** | Refunds AzamPay refused; "Record chase" note (audit only). |
| Doctor | Portal → **Earnings** | One row per completed paid consultation with status (`PENDING`), plus two totals: "Pending" and all-time "Amount". |
| Patient | App → Appointment details | Payment status line; refund status if cancelled. |

- **Exports:** none — no CSV/Excel/PDF downloads anywhere.
- **Reporting quirk:** the doctor's "Pending" total adds up only the rows on the
  **page currently shown**, so it is too low once a doctor has more than one
  page of earnings (the all-time "Amount" total is correct).
- Every payment event (completed, failed, refunded, refund failed, unknown
  webhook, bad signature, earning created) is written to the **audit log**,
  but there is no screen to browse it.

---

## 7. Gaps and risks before real money

Ordered by how much money or trust they could cost.

| # | Gap | Why it matters | Severity |
|---|---|---|---|
| 1 | **AzamPay integration never tested against AzamPay itself.** Every test and all device testing used the built-in fake or the dev-only "mark as paid" route. The endpoints, the shape of AzamPay's replies, and the refund call are written to an assumed API. | The first real payment may fail in ways nobody has seen. | **Critical** |
| 2 | **Late success after expiry or cancellation = patient charged, no service, no refund.** When the 30-minute window passes (or the patient cancels an unpaid booking), the appointment is cancelled but the payment stays `PROCESSING`. If the patient approves the PIN late, AzamPay reports success, the payment becomes `COMPLETED`, the appointment cannot be re-confirmed, and **no refund is triggered and nothing flags it**. The dev database already has three such rows: cancelled appointments whose payments (15,000, 15,000 and 60,000 TZS) are still `PROCESSING` — two cancelled by the patient while unpaid, one by the 30-minute timeout. | Real money taken for nothing; customer complaints; regulator risk. | **Critical** |
| 3 | **No doctor payouts at all** (section 4). | Doctors cannot be paid through the system; no record of what was paid. | **Critical** for launch |
| 4 | **Webhook signature format is assumed.** We check an `x-azampay-signature` header (HMAC-SHA256 of the body). Whether AzamPay actually signs callbacks this way — and with which field names in the body — is unverified. If it doesn't match, **every** real webhook is rejected (we'd fall back on the 1-minute status check); if the body fields differ, they're rejected as invalid. | Payments confirm slowly or not at all. | High |
| 5 | **The amount paid is never checked.** The webhook carries an amount, but the code does not compare it with the fee owed (nor does the status check). | An under-payment would still confirm the appointment. | High |
| 6 | **No reconciliation with AzamPay statements.** Nothing compares our records with AzamPay's settlement reports or the money actually received in the bank. | Missing or extra money goes unnoticed. | High |
| 7 | **AzamPay calls have no timeout.** A hung connection to AzamPay can hang the booking or the minute-by-minute check. | Stuck bookings during an AzamPay outage. | Medium |
| 8 | **Stuck refunds can't be finished in the system.** No retry, no "refund done manually" button; the flag stays forever. | Admin cannot close the loop; reporting stays wrong. | Medium |
| 9 | **Platform fee is a fixed 10% in code;** AzamPay's own charges are not accounted for. | Margin is lower than it looks; changes need a release. | Medium |
| 10 | **No financial reports or exports** (revenue, platform fees, amounts owed per doctor, refunds, per period). | Accounting and tax filing must be done by hand from the database. | Medium |
| 11 | **Only one payment record per appointment and only mobile money.** NHIF and cash are planned but not built; such consultations create no earnings. | Doctors on those consultations show zero earnings. | Low (until NHIF) |
| 12 | **Doctor "Pending" total is page-limited** and the Earnings subtitle promises payouts that don't exist. | Misleading numbers for doctors. | Low |

**Testing note:** in development, payments are completed with a dev-only route
(`POST /api/v1/dev/payments/:appointmentId/complete`, see
`docs/pilot-runbook.md`). It runs the same code path as a real AzamPay
success, and it does not exist in production builds.

### Suggested order before going live

1. Get AzamPay sandbox credentials and run real collections, failures, the
   webhook and a refund end to end (fixes #1, confirms #4).
2. Close the late-success hole (#2): when a payment completes for an
   appointment that is no longer payable, refund it automatically (or flag it).
3. Check the paid amount against the fee (#5) and add request timeouts (#7).
4. Decide how doctors will be paid and build at least a manual payout record
   ("mark paid" with reference and date) before the first payout (#3).
5. Add a monthly statement/export and a reconciliation routine against
   AzamPay's settlement report (#6, #10).

---

## Appendix — where this lives in the code (for engineers)

| Topic | File |
|---|---|
| Fee split, 10% constant, rounding | `packages/payments/src/money.ts` (`splitFee`, `DEFAULT_PLATFORM_FEE_PERCENT`) |
| Payment lifecycle, webhook handling, reconciliation, refunds, accrual | `services/api-server/src/modules/payments/payment.service.ts` |
| Webhook route (signature first, then validation) | `services/api-server/src/modules/payments/webhook.routes.ts` |
| AzamPay adapter (token, checkout, status, refund, signature) | `packages/payments/src/azampay.ts` |
| Payment routes (`/appointments/:id/pay`, `/payments/me`, `/doctors/me/earnings`, `/admin/payments`, `/admin/refunds/*`) | `services/api-server/src/modules/payments/payment.routes.ts` |
| 30-min expiry, 2-hour cancellation window, refund trigger | `services/api-server/src/modules/appointments/appointment.service.ts`, `appointment.machine.ts` |
| Earning created on completion | `ConsultationService.complete` → `PaymentService.accrueForConsultation` |
| Earnings storage (accrual + read only; no payout methods) | `packages/db/src/repositories/doctor-payment.repository.ts` |
| Schema: `Payment`, `DoctorPayment`, status enums | `packages/db/prisma/schema.prisma` |
| Admin / doctor pages | `apps/web/src/app/admin/payments/page.tsx`, `apps/web/src/app/doctor/earnings/page.tsx` |
| Production refuses to start without AzamPay credentials | `services/api-server/src/lib/production-guard.ts` |
