# Dev-only: driving the doctor side of a consultation

> **The web portal now exists (Phase 11).** For the full pilot loop — admin
> verifies a doctor → doctor sets a schedule → patient books on mobile → doctor
> conducts in the portal → completes → patient rates — follow
> [`pilot-runbook.md`](./pilot-runbook.md) instead. Keep this page for scripted
> debugging of a single API call without a browser.

This is the manual harness that plays the doctor so you can test the **patient**
mobile app end-to-end: start a consultation, exchange live chat over WebSocket,
and complete with clinical notes.

**These are development instructions against a local server. Do not run against
production.** They assume the API on `http://localhost:4000`, an APPROVED
doctor account, and a CONFIRMED remote appointment (VIDEO/AUDIO/CHAT) that the
patient already booked and paid for (see `docs`/README for booking + the
FakePayments webhook).

Set your shell up first (PowerShell):

```powershell
$API = 'http://localhost:4000'
$DOCTOR_PHONE = '+255700000101'   # your seeded/approved doctor
$DOCTOR_PASS  = 'Doctor-Pass-1!'
$APPOINTMENT_ID = '<the CONFIRMED appointment id>'
```

## 1. Doctor login → access token

```powershell
$login = Invoke-RestMethod -Uri "$API/api/v1/auth/login" -Method Post `
  -ContentType 'application/json' `
  -Body (@{ phone = $DOCTOR_PHONE; password = $DOCTOR_PASS } | ConvertTo-Json)
$TOKEN = $login.accessToken
$H = @{ Authorization = "Bearer $TOKEN" }
```

## 2. Start the consultation (patient's waiting room auto-advances)

Drives the Phase 4 `START_CONSULTATION` transition. For VIDEO/AUDIO it also
creates the Daily room and returns the doctor's meeting token.

```powershell
$consult = Invoke-RestMethod -Uri "$API/api/v1/consultations/start" -Method Post `
  -Headers $H -ContentType 'application/json' `
  -Body (@{ appointmentId = $APPOINTMENT_ID } | ConvertTo-Json)
$CONSULTATION_ID = $consult.id
$consult          # note: consult.meetingToken + consult.videoRoomUrl for a real call
```

At this point the patient app's waiting room (polling
`GET /consultations/by-appointment/:id`) sees `IN_PROGRESS` and transitions into
the call/chat screen.

## 3. Send a live chat message over WebSocket (tiny node script)

The doctor needs a WS ticket, then opens the socket, joins the channel, and
sends a `chat.message`. Save as `docs/ws-doctor-chat.mjs` and run with
`node docs/ws-doctor-chat.mjs <TOKEN> <CONSULTATION_ID>` (needs the `ws`
package, already a dev dep of the api-server workspace):

```js
// docs/ws-doctor-chat.mjs
import WebSocket from 'ws';

const [, , token, consultationId] = process.argv;
const API = process.env.API ?? 'http://localhost:4000';

// 1. Exchange the Bearer token for a short-lived single-use WS ticket.
const ticketRes = await fetch(`${API}/api/v1/ws/ticket`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
});
const { ticket } = await ticketRes.json();

// 2. Open the socket with the ticket in the query string (never the JWT).
const wsUrl = API.replace(/^http/, 'ws') + `/ws?ticket=${ticket}`;
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'join', consultationId }));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'chat.message', consultationId, body: 'Habari, mimi ni daktari wako. Unajisikiaje?' }));
  }, 250);
});
ws.on('message', (raw) => console.log('◀', raw.toString()));
// Keep it open a few seconds to receive the patient's reply, then exit.
setTimeout(() => ws.close(), 8000);
```

The patient app receives this over its own WS connection and renders it as an
incoming (left) bubble; its replies come back to this script's `message` log.

## 4. Add clinical notes + a diagnosis, then complete

Notes are the single encrypted blob; completion requires at least `assessment`
and `plan`. Completion generates the immutable medical record and (for paid
MOBILE_MONEY appointments) accrues the doctor's earnings.

```powershell
# Clinical notes (doctor-only, IN_PROGRESS only)
Invoke-RestMethod -Uri "$API/api/v1/consultations/$CONSULTATION_ID/notes" -Method Patch `
  -Headers $H -ContentType 'application/json' `
  -Body (@{
    chiefComplaint          = 'Homa ya siku tatu'
    historyOfPresentIllness = 'Fever, headache, no red flags'
    examination             = 'Chest clear, afebrile now'
    assessment              = 'Suspected uncomplicated malaria'
    plan                    = 'RDT + symptomatic care; review with results'
  } | ConvertTo-Json)

# A diagnosis (ICD-10; PRIMARY | SECONDARY | DIFFERENTIAL — max one PRIMARY)
Invoke-RestMethod -Uri "$API/api/v1/consultations/$CONSULTATION_ID/diagnoses" -Method Post `
  -Headers $H -ContentType 'application/json' `
  -Body (@{ icd10Code = 'B54'; description = 'Unspecified malaria'; type = 'PRIMARY' } | ConvertTo-Json)

# Complete → medical record generated; patient app shows the rating prompt
Invoke-RestMethod -Uri "$API/api/v1/consultations/$CONSULTATION_ID/complete" -Method Post -Headers $H
```

After completion, the patient app's consultation screen shows the "completed"
end state (rating prompt on the appointment detail), and the new record appears
under the Records tab.

## Interrupt / restart testing

To exercise the patient's "consultation interrupted" state, abort instead of
completing (either party may abort; the appointment returns to CONFIRMED once):

```powershell
Invoke-RestMethod -Uri "$API/api/v1/consultations/$CONSULTATION_ID/abort" -Method Post `
  -Headers $H -ContentType 'application/json' `
  -Body (@{ reason = 'network dropped' } | ConvertTo-Json)
```

The patient app shows `consult.ended.interrupted` with the restart-once copy;
re-running step 2 restarts it once. A second abort→restart cycle is rejected by
the server (`RESTART_ALREADY_USED`), which the app surfaces as the
"cannot be restarted — contact support / rebook" copy.
