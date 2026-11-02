# How money moves in Daktari Mkononi

_Plain-language guide to the code as built after Phase 13a (3 November 2026).
Code references for engineers are at the end._

**In one sentence:** patients pay the doctor's consultation fee by mobile
money through AzamPay; the platform keeps a commission (default 20%) plus VAT
on that commission, the doctor's share is recorded as owed, and admins pay
doctors in payout runs — through AzamPay where AzamPay can pay the doctor's
network, manually (with a recorded reference) where it cannot.

**Not yet proven against AzamPay itself:** everything below was built from
AzamPay's published developer documentation (snapshot in
`docs/vendor/azampay-tanzania-v1-openapi.json`) and tested against a
simulator. Run `pnpm azampay:sandbox-test` as soon as sandbox credentials
arrive — see "Open items" at the end.

---

## 1. The patient's payment

1. **Booking** creates the appointment as "waiting for payment" with a
   30-minute window, and one payment record. The fee split (commission, VAT,
   doctor share) is calculated **now** and frozen on the payment together with
   the rates used.
2. **Collection.** We ask AzamPay to collect the fee from the patient's phone
   (network worked out from the number). The payment becomes `PROCESSING`.
   If the request times out, the PIN prompt may still have gone out: the
   payment stays `PROCESSING` (never marked failed) and the patient cannot
   start a second attempt while it is open.
3. **The answer** arrives as an AzamPay callback and/or our own status check
   (every minute, for payments in flight longer than 90 seconds). Both paths
   run the same code. Trust rules for the callback:
   - AzamPay signs callbacks with an RSA key; we verify the signature with the
     public key AzamPay publishes. A **present but invalid** signature is
     rejected.
   - Even a valid callback is **double-checked with AzamPay's status API**
     before we act. If they disagree, nothing is applied and admins are
     alerted (`STATUS_CONFLICT`).
   - An **unsigned** callback is never acted on by itself; it only triggers a
     status check.
4. **Amount check.** If AzamPay reports a different amount from the fee owed
   (or an unreadable one), the money is recorded as received but the
   appointment is **not** confirmed, nothing is refunded automatically, and
   admins are alerted (`AMOUNT_MISMATCH`).
5. **Success while still payable** → payment `COMPLETED`, appointment
   `CONFIRMED`.
6. **Failure** → payment `FAILED`; the patient may retry (new attempt and
   reference) while the window is open.

### Late or orphan payments (the old "charged, no service" hole — closed)

If a payment succeeds for an appointment that has expired, been cancelled or
otherwise cannot be confirmed:

- the appointment is **not** confirmed;
- the payment is flagged `LATE_SUCCESS` on the admin **Needs review** list
  (and in the audit log);
- the patient gets an SMS explaining they will be refunded;
- a **full refund starts automatically** (see §5).

When an unpaid booking expires or is cancelled, its in-flight payment is
**not** forgotten: it is marked _abandoned_ and the status check keeps asking
AzamPay until it is final. If it is still not final after 24 hours, admins
are alerted (`STUCK_PROCESSING`). A late callback for an old, superseded
attempt is flagged `STRAY_ATTEMPT`.

The three dev-database cases (15,000 / 15,000 / 60,000 TZS) were closed by
`packages/db/prisma/scripts/fix-orphan-payments-13a.ts`: all three had
references from the built-in fake provider, so no money could have moved;
they are now `FAILED` with an audit entry.

---

## 2. Fees and VAT

Admins set the rates on **Portal → Fees & VAT**. Every change adds a new,
dated row (it can be scheduled for later, never back-dated) and is audited;
nothing already paid changes, because every payment keeps the rates it was
created with.

| Setting | Default | Limits |
|---|---|---|
| Platform commission | 20% | 0–50% (2 decimals) |
| VAT on commission | on, 18% | 0–30% |
| VAT mode | on top of commission | or included in commission |
| Minimum doctor payout | 10,000 TZS | ≥ 1,000 TZS |
| Per-doctor commission override | none | 0–50%, on the Doctors list, audited |

**VAT is charged on the platform commission only — never on the patient's
consultation fee** (medical services are VAT-exempt). The patient always pays
exactly the doctor's listed fee.

**Calculation (whole shillings):**

- commission = fee × commission %, rounded to the nearest shilling (halves up)
- VAT on top: VAT = commission × VAT %, rounded the same way;
  doctor = fee − commission − VAT
- VAT included: VAT = commission × VAT ÷ (100 + VAT), rounded;
  doctor = fee − commission; platform keeps commission − VAT
- The doctor receives the exact remainder, so commission (excl. VAT) + VAT +
  doctor share always equals the fee — checked by an automated test over
  20,000 random fees and rates.

**Worked examples — 20% commission, 18% VAT on top (the defaults):**

| Fee | Commission (platform) | VAT (to TRA) | Doctor receives |
|---|---|---|---|
| 15,000 | 3,000 | 540 | **11,460** |
| 20,000 | 4,000 | 720 | **15,280** |
| 50,000 | 10,000 | 1,800 | **38,200** |

Same fees with **VAT included in the 20% commission**:

| Fee | Commission charged | of which VAT | Platform keeps | Doctor receives |
|---|---|---|---|---|
| 15,000 | 3,000 | 458 | 2,542 | **12,000** |
| 20,000 | 4,000 | 610 | 3,390 | **16,000** |
| 50,000 | 10,000 | 1,525 | 8,475 | **40,000** |

**AzamPay's own charges** are recorded per transaction when AzamPay tells us
(status answer or an imported statement) and are absorbed by the platform;
they are subtracted in the "net platform revenue" report.

The breakdown is shown on the doctor's Earnings page, the admin payment
detail, and the patient's receipt in the app.

---

## 3. Doctor earnings

An earning (the doctor's share) is created when the doctor completes a paid
consultation. Statuses: **Owed** (`PENDING`) → **Being paid**
(`PROCESSING`) → **Paid**, or **Payout failed** (retried or paid manually),
or **Reversed** (refunded before it was paid). A refund after payment
creates a negative **adjustment** taken off the next payout.

The Earnings page totals (owed / being paid / paid) are calculated by the
server over all earnings — not just the page on screen.

## 4. Doctor payouts

**Payout account.** The doctor saves a mobile-money number (and network) or a
bank account on the Earnings page. We look the holder's name up with AzamPay
and the doctor must confirm it ("The network says this account belongs to
AMINA JUMA — is that you?"). If AzamPay cannot confirm it, an admin verifies
it manually. Any change requires confirmation again; every change is
audited.

**Payout run (Portal → Doctor payouts).**
1. Pick a cutoff date: the preview shows, per doctor, what is owed and
   whether they will be paid (verified account, at least the minimum payout).
   Below the minimum carries forward to the next run.
2. **Create draft** reserves those earnings for this run only.
3. **Approve & send** sends one AzamPay disbursement per doctor. Earnings
   move to "being paid", then "paid" when AzamPay confirms.
4. A failed payout shows its reason and can be **retried**; a payout can be
   **marked paid manually** with the M-Pesa/bank reference.

**Nothing is ever paid twice:** an earning can only be in one run; a payout is
only sent from "draft" or "failed"; one that timed out stays "being paid" and
is never resent automatically; manual "mark paid" is refused while a known
AzamPay transfer is still in flight.

**Important limit:** AzamPay's disbursement API, as documented, can only pay
**Tigo/Mixx, Airtel and AzamPesa** wallets. Doctors on **M-Pesa, Halopesa or
a bank account** are paid manually by an admin, who records the reference.

## 5. Refunds

AzamPay publishes **no refund API**. A refund is therefore a disbursement of
the full amount received back to the payer's wallet — automatic for Tigo/Mixx
and Airtel payers; **M-Pesa and Halopesa payers land on the admin "Refunds
pending" list** to be refunded manually.

Automatic refunds happen on: paid appointment cancelled (patient ≥ 2h before,
or doctor any time) and late/orphan payments. Admins can also **refund a
completed payment in full** (complaint, amount mismatch), **retry** a failed
refund, or **mark a refund completed manually** with its reference. A refund
can never be sent twice, and a refund that timed out is never resent blind.
Refunding a completed consultation reverses the doctor's earning if unpaid,
or deducts it from their next payout if already paid.

## 6. Reports and reconciliation (Portal → Finance reports)

For any date range (EAT): **collected, refunded, commission (excl. VAT, net of
refunds), VAT due, known AzamPay fees, doctor payouts (AzamPay vs manual),
net platform revenue** (= commission − AzamPay fees). Money received for no
consultation (late/mismatched) is shown separately, never as revenue.
**Download CSV** gives the totals plus one line per payment and payout.

**Reconciliation:** upload the statement CSV from the AzamPay merchant
portal. It lists what is in AzamPay but not in our records, in our records
but not in the statement, and amount or status differences; it can also
record AzamPay's fee per transaction. (AzamPay documents no statement API,
so this is an upload.)

## 7. What admins and doctors see

| Who | Where | What |
|---|---|---|
| Admin | Payments | All payments, filters, split with VAT and rates, **Needs review** queue, **Refunds pending** (retry / mark done manually / chase note), full refund |
| Admin | Fees & VAT | Current rates, worked examples, dated changes, history |
| Admin | Doctors | Fee and commission override per doctor |
| Admin | Doctor payouts | Preview, draft, approve, retry, mark paid; accounts awaiting manual verification |
| Admin | Finance reports | Totals, CSV, statement reconciliation |
| Doctor | Earnings | Owed / being paid / paid totals, per-consultation breakdown, payout account |
| Patient | App → appointment | Payment status, refund status, receipt breakdown |

---

## 8. Open items

**Cannot be verified without AzamPay sandbox access** (built to the published
docs, which contradict themselves in places):

1. The callback signature: the docs describe it over four fields in one place
   and two fields in another. We accept the four-field form; the two-field
   form is treated as unsigned (status-checked).
2. Whether the documented status endpoint (written for disbursements) also
   answers for checkout transactions, and the shape of its `data` field.
3. The disbursement `checksum` input fields ("contact us" in the docs) and the
   `transferDetails.type` value for mobile money.
4. Production host names (the docs list sandbox hosts only).
5. Whether AzamPay reports its fee anywhere other than statements.
6. The statement CSV layout (the importer recognises columns by name).

**Run:** fill the sandbox variables in `.env`, then `pnpm azampay:sandbox-test`.

---

## Appendix — where this lives in the code

| Topic | File |
|---|---|
| Fee calculation, rounding, limits | `packages/payments/src/money.ts` (`calculateFees`) |
| Fee settings (effective-dated, overrides) | `services/api-server/src/modules/payments/fee-settings.service.ts`, `FeeSettings` model |
| AzamPay adapter (checkout, status, signature, disbursement, name lookup, refund-as-disbursement, timeouts) | `packages/payments/src/azampay.ts` |
| AzamPay spec snapshot | `docs/vendor/azampay-tanzania-v1-openapi.json` |
| Payment lifecycle, late/orphan handling, review queue, refunds, reconciliation sweep | `services/api-server/src/modules/payments/payment.service.ts` |
| Webhook route (checkout + disbursement callbacks) | `services/api-server/src/modules/payments/webhook.routes.ts` |
| Doctor payouts | `services/api-server/src/modules/payouts/`, `packages/db/src/repositories/payout.repository.ts` |
| Finance reports, CSV, reconciliation import | `services/api-server/src/modules/reports/` |
| Sandbox test | `scripts/azampay-sandbox-test.mjs` (`pnpm azampay:sandbox-test`) |
| Production refuses to start without AzamPay / disbursement settings | `services/api-server/src/lib/production-guard.ts` |
