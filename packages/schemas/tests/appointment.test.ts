import { describe, expect, it } from 'vitest';
import { bookAppointmentSchema } from '../src/appointment.schema.js';

const doctorId = 'clx1q2w3e4r5t6y7u8i9o0p1';
const tomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

describe('bookAppointmentSchema', () => {
  it('accepts a valid future booking', () => {
    const parsed = bookAppointmentSchema.parse({
      doctorId,
      type: 'VIDEO',
      scheduledAt: tomorrow(),
      reason: 'Homa ya siku tatu',
      paymentIntent: 'MOBILE_MONEY',
    });
    expect(parsed.scheduledAt).toBeInstanceOf(Date);
    expect(parsed.type).toBe('VIDEO');
  });

  it('rejects a booking in the past', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      bookAppointmentSchema.parse({
        doctorId,
        type: 'VIDEO',
        scheduledAt: yesterday,
        reason: 'Homa',
        paymentIntent: 'MOBILE_MONEY',
      }),
    ).toThrowError(/future/);
  });

  it('rejects a booking more than 90 days out', () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(() =>
      bookAppointmentSchema.parse({
        doctorId,
        type: 'CHAT',
        scheduledAt: nextYear,
        reason: 'Ukaguzi wa afya',
        paymentIntent: 'NHIF',
      }),
    ).toThrowError(/90 days/);
  });

  it('rejects an unknown appointment type and a bad doctor id', () => {
    expect(() =>
      bookAppointmentSchema.parse({
        doctorId,
        type: 'HOME_VISIT',
        scheduledAt: tomorrow(),
        reason: 'Homa',
        paymentIntent: 'MOBILE_MONEY',
      }),
    ).toThrow();
    expect(() =>
      bookAppointmentSchema.parse({
        doctorId: '507f1f77bcf86cd799439011',
        type: 'VIDEO',
        scheduledAt: tomorrow(),
        reason: 'Homa',
        paymentIntent: 'MOBILE_MONEY',
      }),
    ).toThrow();
  });
});
