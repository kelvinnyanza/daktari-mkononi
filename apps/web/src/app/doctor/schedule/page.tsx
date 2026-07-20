'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useI18nStore, useT, pickBilingual } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import {
  toEditorDays,
  toSlotsPayload,
  validateWeek,
  type EditorDay,
} from '@/lib/schedule-rules';

interface ScheduleResponse {
  slots: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    breaks: Array<{ startTime: string; endTime: string }>;
    slotDurationMinutes: number;
  }>;
}

export default function DoctorSchedulePage() {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const [days, setDays] = useState<EditorDay[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const schedule = useQuery({
    queryKey: ['doctor-schedule'],
    queryFn: () => api.get<ScheduleResponse>('/api/v1/doctors/me/schedule'),
  });

  useEffect(() => {
    if (schedule.data !== undefined && days === null) {
      setDays(toEditorDays(schedule.data.slots));
    }
  }, [schedule.data, days]);

  const save = useMutation({
    mutationFn: (payload: EditorDay[]) =>
      api.put<ScheduleResponse>('/api/v1/doctors/me/schedule', { slots: toSlotsPayload(payload) }),
    onSuccess: (result) => {
      setDays(toEditorDays(result.slots));
      setSaved(true);
      setServerError(null);
    },
    onError: (error) => {
      setSaved(false);
      setServerError(
        error instanceof ApiError
          ? (pickBilingual(error.userMessage, locale) ?? error.code)
          : t('common.error'),
      );
    },
  });

  if (schedule.isPending || days === null) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (schedule.isError) {
    return <p className="text-sm text-destructive">{t('common.error')}</p>;
  }

  const errors = validateWeek(days);
  const update = (dayOfWeek: number, patch: Partial<EditorDay>) => {
    setSaved(false);
    setDays((current) =>
      (current ?? []).map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, ...patch } : day)),
    );
  };

  return (
    <>
      <PageHeader title={t('schedule.title')} subtitle={t('schedule.subtitle')} />

      <div className="flex max-w-3xl flex-col gap-3">
        {days.map((day) => {
          const error = errors.get(day.dayOfWeek);
          return (
            <Card key={day.dayOfWeek}>
              <CardContent className="flex flex-col gap-3 pt-4">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex min-w-[9rem] items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={day.enabled}
                      onChange={(event) => {
                        update(day.dayOfWeek, { enabled: event.target.checked });
                      }}
                      className="h-4 w-4"
                    />
                    {t(`schedule.day.${day.dayOfWeek}` as TranslationKey)}
                  </label>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`start-${day.dayOfWeek}`}>{t('schedule.start')}</Label>
                    <Input
                      id={`start-${day.dayOfWeek}`}
                      type="time"
                      className="w-32"
                      value={day.startTime}
                      disabled={!day.enabled}
                      onChange={(event) => {
                        update(day.dayOfWeek, { startTime: event.target.value });
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`end-${day.dayOfWeek}`}>{t('schedule.end')}</Label>
                    <Input
                      id={`end-${day.dayOfWeek}`}
                      type="time"
                      className="w-32"
                      value={day.endTime}
                      disabled={!day.enabled}
                      onChange={(event) => {
                        update(day.dayOfWeek, { endTime: event.target.value });
                      }}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`slot-${day.dayOfWeek}`}>{t('schedule.slotDuration')}</Label>
                    <Input
                      id={`slot-${day.dayOfWeek}`}
                      type="number"
                      min={10}
                      max={120}
                      step={5}
                      className="w-24"
                      value={day.slotDurationMinutes}
                      disabled={!day.enabled}
                      onChange={(event) => {
                        update(day.dayOfWeek, { slotDurationMinutes: Number(event.target.value) });
                      }}
                    />
                  </div>

                  {day.enabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => {
                        update(day.dayOfWeek, {
                          breaks: [...day.breaks, { startTime: '13:00', endTime: '14:00' }],
                        });
                      }}
                    >
                      {t('schedule.addBreak')}
                    </Button>
                  )}
                </div>

                {day.enabled &&
                  day.breaks.map((entry, index) => (
                    <div key={index} className="flex items-end gap-3 pl-4">
                      <span className="pb-2 text-xs text-muted-foreground">{t('schedule.breaks')}</span>
                      <Input
                        aria-label={`${t('schedule.breaks')} ${t('schedule.start')}`}
                        type="time"
                        className="w-32"
                        value={entry.startTime}
                        onChange={(event) => {
                          const breaks = day.breaks.map((item, position) =>
                            position === index ? { ...item, startTime: event.target.value } : item,
                          );
                          update(day.dayOfWeek, { breaks });
                        }}
                      />
                      <Input
                        aria-label={`${t('schedule.breaks')} ${t('schedule.end')}`}
                        type="time"
                        className="w-32"
                        value={entry.endTime}
                        onChange={(event) => {
                          const breaks = day.breaks.map((item, position) =>
                            position === index ? { ...item, endTime: event.target.value } : item,
                          );
                          update(day.dayOfWeek, { breaks });
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          update(day.dayOfWeek, {
                            breaks: day.breaks.filter((_item, position) => position !== index),
                          });
                        }}
                      >
                        {t('schedule.removeBreak')}
                      </Button>
                    </div>
                  ))}

                {error !== undefined && (
                  <p role="alert" className="text-xs text-destructive">
                    {t(error)}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}

        <div className="flex items-center gap-3">
          <Button
            disabled={errors.size > 0 || save.isPending}
            onClick={() => {
              save.mutate(days);
            }}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
          {saved && <span className="text-xs text-muted-foreground">{t('schedule.saved')}</span>}
          {serverError !== null && (
            <span role="alert" className="text-xs text-destructive">
              {serverError}
            </span>
          )}
        </div>
      </div>
    </>
  );
}
