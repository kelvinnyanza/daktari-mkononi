/**
 * Client mirror of `doctorScheduleSlotSchema` (packages/schemas). HH:mm strings
 * compare lexically, which is exactly how the server compares them too.
 * The server re-validates everything; this only keeps the editor honest.
 */
export interface EditorBreak {
  startTime: string;
  endTime: string;
}

export interface EditorDay {
  dayOfWeek: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
  breaks: EditorBreak[];
  slotDurationMinutes: number;
}

export type ScheduleError = 'schedule.invalidRange' | 'schedule.invalidBreak';

/** First rule a day violates, or null when it is submittable. */
export function validateDay(day: EditorDay): ScheduleError | null {
  if (!day.enabled) return null;
  if (day.startTime >= day.endTime) return 'schedule.invalidRange';
  for (const entry of day.breaks) {
    if (entry.startTime >= entry.endTime) return 'schedule.invalidBreak';
    if (entry.startTime < day.startTime || entry.endTime > day.endTime) {
      return 'schedule.invalidBreak';
    }
  }
  return null;
}

export function validateWeek(days: EditorDay[]): Map<number, ScheduleError> {
  const errors = new Map<number, ScheduleError>();
  for (const day of days) {
    const error = validateDay(day);
    if (error !== null) errors.set(day.dayOfWeek, error);
  }
  return errors;
}

/** Editor state → the `slots` payload; disabled days are simply omitted. */
export function toSlotsPayload(days: EditorDay[]): Array<{
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  breaks: EditorBreak[];
  slotDurationMinutes: number;
}> {
  return days
    .filter((day) => day.enabled)
    .map((day) => ({
      dayOfWeek: day.dayOfWeek,
      startTime: day.startTime,
      endTime: day.endTime,
      breaks: day.breaks,
      slotDurationMinutes: day.slotDurationMinutes,
    }));
}

const DEFAULT_DAY = { startTime: '09:00', endTime: '17:00', slotDurationMinutes: 30 };

/** Server slots → a full seven-day editor (missing days render as disabled). */
export function toEditorDays(
  slots: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    breaks: EditorBreak[];
    slotDurationMinutes: number;
  }>,
): EditorDay[] {
  return Array.from({ length: 7 }, (_unused, dayOfWeek) => {
    const slot = slots.find((entry) => entry.dayOfWeek === dayOfWeek);
    if (slot === undefined) {
      return { dayOfWeek, enabled: false, breaks: [], ...DEFAULT_DAY };
    }
    return {
      dayOfWeek,
      enabled: true,
      startTime: slot.startTime,
      endTime: slot.endTime,
      breaks: slot.breaks,
      slotDurationMinutes: slot.slotDurationMinutes,
    };
  });
}
