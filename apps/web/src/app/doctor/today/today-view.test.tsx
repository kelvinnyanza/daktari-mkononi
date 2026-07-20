import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/doctor/today',
}));

const get = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (path: string) => get(path) as unknown,
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {},
}));

import DoctorTodayPage from './page';

/** 09:15 EAT on 20 July 2026 = 06:15 UTC. */
const FIXED_NOW = new Date('2026-07-20T06:15:00.000Z');

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DAY_RESPONSE = {
  date: '2026-07-20',
  page: 1,
  pageSize: 50,
  total: 3,
  items: [
    {
      id: 'appt-1',
      patientId: 'p1',
      type: 'VIDEO',
      status: 'CONFIRMED',
      // 09:00 EAT
      scheduledAt: '2026-07-20T06:00:00.000Z',
      durationMinutes: 30,
      reason: 'Fever and headache',
      paymentIntent: 'PAID',
      pendingReason: null,
    },
    {
      id: 'appt-2',
      patientId: 'p2',
      type: 'AUDIO',
      status: 'IN_PROGRESS',
      // 14:30 EAT
      scheduledAt: '2026-07-20T11:30:00.000Z',
      durationMinutes: 20,
      reason: 'Follow-up',
      paymentIntent: 'PAID',
      pendingReason: null,
    },
    {
      id: 'appt-3',
      patientId: 'p3',
      type: 'VIDEO',
      status: 'PENDING_PAYMENT',
      // 23:00 EAT — still the same EAT calendar day at 20:00 UTC
      scheduledAt: '2026-07-20T20:00:00.000Z',
      durationMinutes: 30,
      reason: 'Late consult',
      paymentIntent: 'PENDING',
      pendingReason: null,
    },
  ],
};

describe('doctor day view (fixed clock, EAT)', () => {
  beforeEach(() => {
    get.mockReset();
    push.mockReset();
    get.mockResolvedValue(DAY_RESPONSE);
  });

  it('requests the EAT calendar date for the injected clock, not the UTC date', async () => {
    render(<DoctorTodayPage now={() => FIXED_NOW} />, { wrapper });

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith(
        '/api/v1/doctors/me/appointments?date=2026-07-20&pageSize=50',
      );
    });
  });

  it('renders each appointment at its EAT wall-clock time', async () => {
    render(<DoctorTodayPage now={() => FIXED_NOW} />, { wrapper });

    expect(await screen.findByText('09:00')).toBeInTheDocument();
    expect(screen.getByText('14:30')).toBeInTheDocument();
    // 20:00 UTC renders as 23:00 EAT on the same calendar day.
    expect(screen.getByText('23:00')).toBeInTheDocument();
  });

  it('shows a status chip per appointment', async () => {
    render(<DoctorTodayPage now={() => FIXED_NOW} />, { wrapper });

    expect(await screen.findByText('CONFIRMED')).toBeInTheDocument();
    expect(screen.getByText('IN_PROGRESS')).toBeInTheDocument();
    expect(screen.getByText('PENDING_PAYMENT')).toBeInTheDocument();
  });

  it('flags an unpaid booking', async () => {
    render(<DoctorTodayPage now={() => FIXED_NOW} />, { wrapper });
    expect(await screen.findByText('Unpaid')).toBeInTheDocument();
  });

  it('offers start only on startable statuses and resume on IN_PROGRESS', async () => {
    render(<DoctorTodayPage now={() => FIXED_NOW} />, { wrapper });

    // CONFIRMED → start; IN_PROGRESS → resume; PENDING_PAYMENT → neither.
    expect(await screen.findAllByRole('button', { name: 'Start consultation' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Resume consultation' })).toHaveLength(1);
  });

  it('uses the EAT date near the UTC day boundary', async () => {
    // 22:30 UTC on 20 July is 01:30 EAT on 21 July — the doctor's "today"
    // must be the 21st, or they would see the wrong day's list.
    render(<DoctorTodayPage now={() => new Date('2026-07-20T22:30:00.000Z')} />, { wrapper });

    await waitFor(() => {
      expect(get).toHaveBeenCalledWith(
        '/api/v1/doctors/me/appointments?date=2026-07-21&pageSize=50',
      );
    });
  });
});
