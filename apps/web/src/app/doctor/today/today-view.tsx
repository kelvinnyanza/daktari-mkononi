'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useI18nStore, useT, pickBilingual } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { eatDateOf, eatTimeLabel, shiftEatDate } from '@/lib/eat';
import { appointmentStatusTone } from '@/lib/status';

interface AppointmentRow {
  id: string;
  patientId: string;
  type: string;
  status: string;
  scheduledAt: string;
  durationMinutes: number;
  reason: string;
  paymentIntent: string;
  pendingReason: string | null;
}

interface DayResponse {
  date: string;
  items: AppointmentRow[];
  page: number;
  pageSize: number;
  total: number;
}

/** Statuses a consultation can be started from (server: START_CONSULTATION). */
const STARTABLE = new Set(['CONFIRMED', 'CHECKED_IN']);

export function TodayView({
  /** Injected by tests; production reads the real clock. */
  now = () => new Date(),
}: {
  now?: () => Date;
}) {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const router = useRouter();
  const queryClient = useQueryClient();

  const today = eatDateOf(now());
  const [date, setDate] = useState(today);
  const [checkInToken, setCheckInToken] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const day = useQuery({
    queryKey: ['doctor-day', date],
    queryFn: () => api.get<DayResponse>(`/api/v1/doctors/me/appointments?date=${date}&pageSize=50`),
  });

  const onError = (error: unknown) => {
    setActionError(
      error instanceof ApiError
        ? (pickBilingual(error.userMessage, locale) ?? error.code)
        : t('common.error'),
    );
  };

  const checkIn = useMutation({
    // The token is what the patient presents — the doctor's own day view never
    // exposes it (the server omits it from this projection on purpose).
    mutationFn: (token: string) => api.post('/api/v1/appointments/check-in', { checkInToken: token }),
    onSuccess: async () => {
      setCheckInToken('');
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['doctor-day', date] });
    },
    onError,
  });

  const start = useMutation({
    mutationFn: (appointmentId: string) =>
      api.post<{ id: string }>('/api/v1/consultations/start', { appointmentId }),
    onSuccess: (consultation) => {
      router.push(`/doctor/consultation/${consultation.id}`);
    },
    onError,
  });

  const resume = useMutation({
    mutationFn: (appointmentId: string) =>
      api.get<{ consultation: { id: string } | null }>(
        `/api/v1/consultations/for-appointment/${appointmentId}`,
      ),
    onSuccess: (result) => {
      if (result.consultation === null) {
        setActionError(t('common.error'));
        return;
      }
      router.push(`/doctor/consultation/${result.consultation.id}`);
    },
    onError,
  });

  return (
    <>
      <PageHeader title={t('today.title')} subtitle={t('today.subtitle', { date })} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDate((current) => shiftEatDate(current, -1));
          }}
        >
          ← {t('today.previousDay')}
        </Button>
        <Button
          size="sm"
          variant={date === today ? 'default' : 'outline'}
          onClick={() => {
            setDate(today);
          }}
        >
          {t('today.jumpToday')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDate((current) => shiftEatDate(current, 1));
          }}
        >
          {t('today.nextDay')} →
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Input
            aria-label={t('today.checkIn')}
            placeholder={t('today.checkIn')}
            className="w-56"
            value={checkInToken}
            onChange={(event) => {
              setCheckInToken(event.target.value);
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={checkInToken.trim().length < 16 || checkIn.isPending}
            onClick={() => {
              checkIn.mutate(checkInToken.trim());
            }}
          >
            {t('today.checkIn')}
          </Button>
        </div>
      </div>

      {actionError !== null && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {actionError}
        </p>
      )}

      {day.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : day.isError ? (
        <p className="text-sm text-destructive">{t('common.error')}</p>
      ) : day.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('today.empty')}</p>
      ) : (
        <div className="flex max-w-3xl flex-col gap-2">
          {day.data.items.map((appointment) => (
            <Card key={appointment.id}>
              <CardContent className="flex flex-wrap items-center gap-4 pt-4">
                {/* Wall-clock EAT, computed by arithmetic — never the browser's
                    local timezone, which may not be Dar es Salaam. */}
                <span className="w-16 font-mono text-lg font-semibold tabular-nums">
                  {eatTimeLabel(appointment.scheduledAt)}
                </span>
                <div className="flex min-w-[12rem] flex-col">
                  <span className="text-sm">{appointment.reason}</span>
                  <span className="text-xs text-muted-foreground">
                    {appointment.type} · {appointment.durationMinutes} min
                  </span>
                </div>
                <Badge tone={appointmentStatusTone(appointment.status)}>{appointment.status}</Badge>
                {appointment.paymentIntent !== 'PAID' && (
                  <Badge tone="warning">{t('today.paymentUnpaid')}</Badge>
                )}

                <div className="ml-auto flex gap-2">
                  {STARTABLE.has(appointment.status) && (
                    <Button
                      size="sm"
                      disabled={start.isPending}
                      onClick={() => {
                        setActionError(null);
                        start.mutate(appointment.id);
                      }}
                    >
                      {t('today.startConsultation')}
                    </Button>
                  )}
                  {appointment.status === 'IN_PROGRESS' && (
                    <Button
                      size="sm"
                      disabled={resume.isPending}
                      onClick={() => {
                        setActionError(null);
                        resume.mutate(appointment.id);
                      }}
                    >
                      {t('today.resume')}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
