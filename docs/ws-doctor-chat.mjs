// Dev-only doctor-side WS chat driver. See docs/dev-doctor-flow.md.
// Usage: node docs/ws-doctor-chat.mjs <ACCESS_TOKEN> <CONSULTATION_ID>
//   API base overridable via the API env var (default http://localhost:4000).
import WebSocket from 'ws';

const [, , token, consultationId] = process.argv;
const API = process.env.API ?? 'http://localhost:4000';

if (!token || !consultationId) {
  console.error('Usage: node docs/ws-doctor-chat.mjs <ACCESS_TOKEN> <CONSULTATION_ID>');
  process.exit(1);
}

// 1. Exchange the Bearer token for a short-lived single-use WS ticket.
const ticketRes = await fetch(`${API}/api/v1/ws/ticket`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
});
if (!ticketRes.ok) {
  console.error('ticket request failed', ticketRes.status, await ticketRes.text());
  process.exit(1);
}
const { ticket } = await ticketRes.json();

// 2. Open the socket with the ticket in the query string (never the JWT).
const wsUrl = API.replace(/^http/, 'ws') + `/ws?ticket=${ticket}`;
const ws = new WebSocket(wsUrl);

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'join', consultationId }));
  setTimeout(() => {
    ws.send(
      JSON.stringify({
        type: 'chat.message',
        consultationId,
        body: 'Habari, mimi ni daktari wako. Unajisikiaje?',
      }),
    );
  }, 250);
});
ws.on('message', (raw) => console.log('◀', raw.toString()));
ws.on('error', (err) => console.error('ws error', err.message));

// Keep it open a few seconds to receive the patient's reply, then exit.
setTimeout(() => ws.close(), 8000);
