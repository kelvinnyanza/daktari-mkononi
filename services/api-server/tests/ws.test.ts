/**
 * WebSocket gateway tests: real Fastify listen on an ephemeral port, real ws
 * client. Fakes behind the ports; no Postgres needed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { decryptHealthData } from '@daktari/encryption';
import { signAccessToken } from '@daktari/auth';
import { randomUUID } from 'node:crypto';
import type { User } from '@daktari/db';
import { applyTestEnv } from './helpers/env.js';
import { makeFakeDeps, type FakeDeps } from './helpers/fakes.js';
import type { BuiltApp } from '../src/app.js';

let deps: FakeDeps;
let built: BuiltApp;
let baseUrl: string;
let wsUrl: string;

let doctorUser: User;
let patientUser: User;
let strangerUser: User;
let consultationId: string;

async function tokenFor(user: User): Promise<string> {
  const sessionId = randomUUID();
  await deps.sessions.create({
    id: sessionId,
    userId: user.id,
    refreshTokenHash: randomUUID(),
    tokenFamily: randomUUID(),
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 60 * 60_000),
  });
  return signAccessToken({ sub: user.id, role: user.role, sessionId });
}

async function fetchTicket(bearer: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/ws/ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}` },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { ticket: string; expiresInSeconds: number };
  expect(body.expiresInSeconds).toBe(30);
  return body.ticket;
}

function connect(ticket: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}/ws?ticket=${ticket}`);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

/** Wait for the next frame matching the predicate (with a hard timeout). */
function nextFrame(socket: WebSocket, match: (frame: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for frame')), 3000);
    const onMessage = (raw: WebSocket.RawData): void => {
      const frame = JSON.parse(String(raw)) as Record<string, unknown>;
      if (match(frame)) {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve(frame);
      }
    };
    socket.on('message', onMessage);
  });
}

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

beforeAll(async () => {
  applyTestEnv();
  deps = makeFakeDeps();
  const { buildAppWithServices } = await import('../src/app.js');
  built = await buildAppWithServices({ deps, redis: null, logger: false });
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const address = built.app.server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;

  // A running consultation with a doctor and patient.
  const doctorSeed = deps.seedDoctor({}, { verificationStatus: 'APPROVED' });
  const patientSeed = deps.seedPatient();
  const strangerSeed = deps.seedPatient({ phone: '+255754999333' });
  doctorUser = doctorSeed.user;
  patientUser = patientSeed.user;
  strangerUser = strangerSeed.user;

  const booked = await built.services.appointments.book(patientUser.id, {
    doctorId: doctorSeed.doctor.id,
    type: 'CHAT',
    scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    reason: 'Chat consultation',
    paymentIntent: 'MOBILE_MONEY',
  });
  await built.services.appointments.handlePaymentCompleted(booked.id);
  const started = await built.services.consultations.start(doctorUser.id, booked.id);
  consultationId = started.id;
});

afterAll(async () => {
  await built?.app.close();
});

describe('ws tickets', () => {
  it('a ticket is single-use: the second connection is closed with 4401', async () => {
    const ticket = await fetchTicket(await tokenFor(patientUser));
    const first = await connect(ticket);
    expect(first.readyState).toBe(WebSocket.OPEN);

    const second = await connect(ticket); // same ticket replayed
    expect(await closeCode(second)).toBe(4401);
    first.close();
  });

  it('rejects unknown/garbage tickets at the gateway', async () => {
    const socket = await connect('expired-or-unknown-ticket');
    expect(await closeCode(socket)).toBe(4401);
  });

  it('expires tickets after 30 seconds and enforces single use (clock-injected)', async () => {
    const { WsTicketStore } = await import('../src/modules/ws/ticket-store.js');
    const clock = { now: new Date('2026-07-16T09:00:00.000Z') };
    const store = new WsTicketStore(() => clock.now);

    // Single use.
    const { ticket } = store.issue('user-1', 'PATIENT');
    expect(store.redeem(ticket)).toEqual({ userId: 'user-1', role: 'PATIENT' });
    expect(store.redeem(ticket)).toBeNull();

    // Expiry: 30s TTL, 31s later it is dead even if never used.
    const { ticket: shortLived, expiresInSeconds } = store.issue('user-2', 'PATIENT');
    expect(expiresInSeconds).toBe(30);
    clock.now = new Date(clock.now.getTime() + 31_000);
    expect(store.redeem(shortLived)).toBeNull();
  });

  it('rejects a connection with no ticket at all', async () => {
    const socket = new WebSocket(`${wsUrl}/ws`);
    const code = await new Promise<number>((resolve) => socket.once('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });

  it('requires authentication to obtain a ticket', async () => {
    const response = await fetch(`${baseUrl}/api/v1/ws/ticket`, { method: 'POST' });
    expect(response.status).toBe(401);
  });
});

describe('channels + chat', () => {
  it('non-participant join is rejected', async () => {
    const socket = await connect(await fetchTicket(await tokenFor(strangerUser)));
    socket.send(JSON.stringify({ type: 'join', consultationId }));
    const frame = await nextFrame(socket, (f) => f.type === 'error');
    expect(frame.code).toBe('NOT_A_PARTICIPANT');
    socket.close();
  });

  it('chat round-trip: joined participants exchange messages; bodies encrypted at rest', async () => {
    const doctorSocket = await connect(await fetchTicket(await tokenFor(doctorUser)));
    const patientSocket = await connect(await fetchTicket(await tokenFor(patientUser)));

    // Both join; the doctor sees the patient's participant.joined event.
    doctorSocket.send(JSON.stringify({ type: 'join', consultationId }));
    await nextFrame(doctorSocket, (f) => f.type === 'joined');
    const joinedEvent = nextFrame(doctorSocket, (f) => f.type === 'participant.joined');
    patientSocket.send(JSON.stringify({ type: 'join', consultationId }));
    await nextFrame(patientSocket, (f) => f.type === 'joined');
    expect((await joinedEvent).userId).toBe(patientUser.id);

    // Patient sends; doctor receives the broadcast.
    const delivery = nextFrame(doctorSocket, (f) => f.type === 'chat.message');
    patientSocket.send(
      JSON.stringify({ type: 'chat.message', consultationId, body: 'Nina homa kali sana' }),
    );
    const received = await delivery;
    expect(received.body).toBe('Nina homa kali sana');
    expect(received.senderUserId).toBe(patientUser.id);

    // Persisted encrypted at rest, decryptable server-side.
    const stored = [...deps.state.consultationMessages.values()].find(
      (m) => m.senderUserId === patientUser.id,
    )!;
    expect(stored.encryptedBody).not.toContain('homa');
    expect(decryptHealthData(stored.encryptedBody)).toBe('Nina homa kali sana');

    // Sending without joining first is rejected.
    const loneSocket = await connect(await fetchTicket(await tokenFor(doctorUser)));
    loneSocket.send(JSON.stringify({ type: 'chat.message', consultationId, body: 'hello' }));
    const lone = await nextFrame(loneSocket, (f) => f.type === 'error');
    expect(lone.code).toBe('JOIN_FIRST');

    // participant.left fires on disconnect.
    const left = nextFrame(doctorSocket, (f) => f.type === 'participant.left');
    patientSocket.close();
    expect((await left).userId).toBe(patientUser.id);

    doctorSocket.close();
    loneSocket.close();
  });

  it('a late joiner is told who is already present (portal opened after the patient)', async () => {
    const patientSocket = await connect(await fetchTicket(await tokenFor(patientUser)));
    patientSocket.send(JSON.stringify({ type: 'join', consultationId }));
    await nextFrame(patientSocket, (f) => f.type === 'joined');

    const doctorSocket = await connect(await fetchTicket(await tokenFor(doctorUser)));
    const present = nextFrame(doctorSocket, (f) => f.type === 'participant.joined');
    doctorSocket.send(JSON.stringify({ type: 'join', consultationId }));
    expect((await present).userId).toBe(patientUser.id);

    // A second patient socket (reconnect overlap): closing the OLD one must
    // not mark the patient as gone; closing the last one must.
    const patientSocket2 = await connect(await fetchTicket(await tokenFor(patientUser)));
    patientSocket2.send(JSON.stringify({ type: 'join', consultationId }));
    await nextFrame(patientSocket2, (f) => f.type === 'joined');
    const leftFrames: string[] = [];
    doctorSocket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as { type: string };
      if (frame.type === 'participant.left') leftFrames.push(frame.type);
    });
    patientSocket.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(leftFrames).toEqual([]);

    const left = nextFrame(doctorSocket, (f) => f.type === 'participant.left');
    patientSocket2.close();
    expect((await left).userId).toBe(patientUser.id);
    doctorSocket.close();
  });

  it('malformed frames answer an error frame instead of crashing the socket', async () => {
    const socket = await connect(await fetchTicket(await tokenFor(patientUser)));
    socket.send('not-json');
    const bad = await nextFrame(socket, (f) => f.type === 'error');
    expect(bad.code).toBe('INVALID_FRAME');
    socket.send(JSON.stringify({ type: 'unknown-type' }));
    const unknown = await nextFrame(socket, (f) => f.type === 'error');
    expect(unknown.code).toBe('INVALID_FRAME');
    socket.close();
  });
});
