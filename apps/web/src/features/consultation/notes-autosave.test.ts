import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canCompleteConsultation,
  createNotesAutosave,
  flushThenComplete,
  isTerminalSaveError,
  NotesNotSavedError,
  savablePatch,
  type Notes,
} from './notes-autosave';

describe('isTerminalSaveError', () => {
  it('treats 409 and 403 as terminal', () => {
    expect(isTerminalSaveError({ status: 409 })).toBe(true);
    expect(isTerminalSaveError({ status: 403 })).toBe(true);
  });

  it('treats network and server errors as transient', () => {
    expect(isTerminalSaveError(new Error('network'))).toBe(false);
    expect(isTerminalSaveError({ status: 500 })).toBe(false);
    expect(isTerminalSaveError({ status: 401 })).toBe(false); // the api layer refreshes
    expect(isTerminalSaveError(null)).toBe(false);
  });
});

describe('createNotesAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not save until the quiet period elapses', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 800 });

    autosave.change('assessment', 'Malaria suspected');
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of keystrokes into ONE request with the final value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 800 });

    autosave.change('plan', 'Give');
    await vi.advanceTimersByTimeAsync(300);
    autosave.change('plan', 'Give ACT');
    await vi.advanceTimersByTimeAsync(300);
    autosave.change('plan', 'Give ACT for 3 days');

    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ plan: 'Give ACT for 3 days' });
  });

  it('sends only the fields that changed, not all five', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 500 });

    autosave.change('chiefComplaint', 'Fever for 3 days');
    autosave.change('examination', 'Temp 38.9');
    await vi.advanceTimersByTimeAsync(500);

    expect(save).toHaveBeenCalledWith({
      chiefComplaint: 'Fever for 3 days',
      examination: 'Temp 38.9',
    });
  });

  it('reports status transitions pending → saving → idle', async () => {
    const statuses: string[] = [];
    const autosave = createNotesAutosave({
      save: () => Promise.resolve(),
      delayMs: 100,
      onStatusChange: (status) => statuses.push(status),
    });

    autosave.change('plan', 'Rest');
    await vi.advanceTimersByTimeAsync(100);

    expect(statuses).toEqual(['pending', 'saving', 'idle']);
  });

  it('never loses an edit made while a save is in flight', async () => {
    // The doctor keeps typing during the request; that text must still land.
    let release: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const autosave = createNotesAutosave({ save, delayMs: 100 });
    autosave.change('assessment', 'first');
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledWith({ assessment: 'first' });

    autosave.change('assessment', 'first and second');
    release?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ assessment: 'first and second' });
  });

  it('keeps the value dirty and retries after a failed save', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const statuses: string[] = [];
    const autosave = createNotesAutosave({
      save,
      delayMs: 100,
      onStatusChange: (status) => statuses.push(status),
    });

    autosave.change('plan', 'Follow up in a week');
    await vi.advanceTimersByTimeAsync(100);

    expect(statuses).toContain('error');
    expect(autosave.dirtyFields()).toEqual(['plan']);

    // The self-healing retry fires on the next quiet period.
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.status()).toBe('idle');
  });

  it('flush() saves immediately without waiting for the debounce', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 10_000 });

    autosave.change('assessment', 'Uncomplicated malaria');
    await autosave.flush();

    expect(save).toHaveBeenCalledWith({ assessment: 'Uncomplicated malaria' });
  });

  it('flush() drains text typed during an in-flight save, in order, before resolving', async () => {
    // The doctor keeps typing while a save is in flight and then hits complete.
    // flush() must not resolve until BOTH batches have reached the server.
    const settled: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const save = vi
      .fn()
      .mockImplementationOnce(
        (patch: Notes) =>
          new Promise<void>((resolve) => {
            releaseFirst = () => {
              settled.push(patch.assessment ?? '');
              resolve();
            };
          }),
      )
      .mockImplementation((patch: Notes) => {
        settled.push(patch.plan ?? '');
        return Promise.resolve();
      });

    const autosave = createNotesAutosave({ save, delayMs: 100 });

    autosave.change('assessment', 'Uncomplicated malaria');
    await vi.advanceTimersByTimeAsync(100); // first save starts and hangs
    expect(save).toHaveBeenCalledTimes(1);

    autosave.change('plan', 'ACT for 3 days'); // typed DURING the in-flight save

    let resolved = false;
    const flushed = autosave.flush().then(() => {
      resolved = true;
    });

    // Still blocked: the first save has not settled.
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(false);

    releaseFirst?.();
    await flushed;

    expect(resolved).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(settled).toEqual(['Uncomplicated malaria', 'ACT for 3 days']);
    expect(autosave.dirtyFields()).toEqual([]);
    expect(autosave.status()).toBe('idle');
  });

  it('complete-during-save: the second PATCH settles before COMPLETE is issued', async () => {
    // This is the exact ordering the workspace relies on — `complete` awaits
    // flush() before POSTing, so a note typed mid-save cannot be lost.
    const calls: string[] = [];
    let releaseFirst: (() => void) | undefined;

    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = () => {
              calls.push('PATCH#1');
              resolve();
            };
          }),
      )
      .mockImplementation(() => {
        calls.push('PATCH#2');
        return Promise.resolve();
      });

    const autosave = createNotesAutosave({ save, delayMs: 100 });
    const complete = async (): Promise<void> => {
      await autosave.flush();
      calls.push('COMPLETE');
    };

    autosave.change('assessment', 'Malaria');
    await vi.advanceTimersByTimeAsync(100);

    autosave.change('plan', 'ACT course'); // typed while PATCH#1 is in flight
    const completed = complete();

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([]); // nothing has settled yet

    releaseFirst?.();
    await completed;

    expect(calls).toEqual(['PATCH#1', 'PATCH#2', 'COMPLETE']);
    expect(autosave.dirtyFields()).toEqual([]);
  });

  it('flush() does not leave a pre-flush keystroke to fire a later save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 100 });

    autosave.change('assessment', 'Malaria');
    autosave.change('plan', 'ACT course');
    await autosave.flush();

    const callsAfterFlush = save.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(save).toHaveBeenCalledTimes(callsAfterFlush);
    expect(autosave.dirtyFields()).toEqual([]);
  });

  it('flush() is a no-op when nothing is dirty', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save });
    await autosave.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['409 — consultation no longer IN_PROGRESS', 409],
    ['403 — no longer this doctor’s consultation', 403],
  ])('stops retrying on a terminal failure (%s)', async (_label, status) => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('refused'), { status }));
    const statuses: string[] = [];
    const autosave = createNotesAutosave({
      save,
      delayMs: 100,
      onStatusChange: (next) => statuses.push(next),
    });

    autosave.change('plan', 'ACT for 3 days');
    await vi.advanceTimersByTimeAsync(100);

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.status()).toBe('stopped');
    expect(statuses).toContain('stopped');
    expect(statuses).not.toContain('error');

    // No self-healing retry — the server is not going to change its mind.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);

    // The unsaved text is surfaced so the UI can name it.
    expect(autosave.dirtyFields()).toEqual(['plan']);
  });

  it.each([
    ['network failure', undefined],
    ['500', 500],
    ['503', 503],
  ])('keeps the self-healing retry on a transient failure (%s)', async (_label, status) => {
    const error = status === undefined ? new Error('network') : Object.assign(new Error('boom'), { status });
    const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 100 });

    autosave.change('plan', 'Follow up in a week');
    await vi.advanceTimersByTimeAsync(100);
    expect(autosave.status()).toBe('error');

    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(autosave.status()).toBe('idle');
    expect(autosave.dirtyFields()).toEqual([]);
  });

  it('ignores further keystrokes once stopped', async () => {
    // Restarting a loop that cannot succeed would only churn requests and
    // overwrite the field list the banner is showing.
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { status: 409 }));
    const autosave = createNotesAutosave({ save, delayMs: 100 });

    autosave.change('plan', 'ACT for 3 days');
    await vi.advanceTimersByTimeAsync(100);
    expect(autosave.status()).toBe('stopped');

    autosave.change('assessment', 'Malaria');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(autosave.status()).toBe('stopped');
    expect(autosave.dirtyFields()).toEqual(['plan']);
  });

  it('flush() resolves rather than hanging when the save is terminal', async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { status: 409 }));
    const autosave = createNotesAutosave({ save, delayMs: 10_000 });

    autosave.change('plan', 'ACT for 3 days');
    await autosave.flush();

    expect(autosave.status()).toBe('stopped');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('dispose() cancels a scheduled save', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const autosave = createNotesAutosave({ save, delayMs: 100 });

    autosave.change('plan', 'Discharge');
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(save).not.toHaveBeenCalled();
  });
});

describe('savablePatch', () => {
  it('drops fields the server would reject as too short', () => {
    // consultationNotesSchema requires min(3) per field.
    expect(savablePatch({ plan: 'ab', assessment: 'Malaria' })).toEqual({ assessment: 'Malaria' });
  });

  it('drops whitespace-only values', () => {
    expect(savablePatch({ plan: '   ' })).toEqual({});
  });
});

describe('flushThenComplete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues COMPLETE after a clean flush, in order', async () => {
    const calls: string[] = [];
    const save = vi.fn().mockImplementation(() => {
      calls.push('PATCH');
      return Promise.resolve();
    });
    const complete = vi.fn().mockImplementation(() => {
      calls.push('COMPLETE');
      return Promise.resolve('done');
    });

    const autosave = createNotesAutosave({ save, delayMs: 10_000 });
    autosave.change('assessment', 'Malaria');

    await expect(flushThenComplete(autosave, complete)).resolves.toBe('done');
    expect(calls).toEqual(['PATCH', 'COMPLETE']);
  });

  it('completes with no PATCH at all when nothing is dirty', async () => {
    const save = vi.fn();
    const complete = vi.fn().mockResolvedValue('done');
    const autosave = createNotesAutosave({ save });

    await expect(flushThenComplete(autosave, complete)).resolves.toBe('done');
    expect(save).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('NEVER issues COMPLETE when a transient failure left notes unsaved', async () => {
    // The record is immutable once completed — closing it around text that
    // only exists in the browser is unrecoverable.
    const save = vi.fn().mockRejectedValue(new Error('network'));
    const complete = vi.fn().mockResolvedValue('done');

    const autosave = createNotesAutosave({ save, delayMs: 100 });
    autosave.change('plan', 'ACT for 3 days');

    const error = await flushThenComplete(autosave, complete).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotesNotSavedError);
    expect((error as NotesNotSavedError).unsavedFields).toEqual(['plan']);
    expect((error as NotesNotSavedError).terminal).toBe(false); // retryable
    expect(complete).not.toHaveBeenCalled();
  });

  it('retry after the connection recovers: PATCH then COMPLETE, in order', async () => {
    const calls: string[] = [];
    const save = vi
      .fn()
      .mockImplementationOnce(() => {
        calls.push('PATCH-failed');
        return Promise.reject(new Error('network'));
      })
      .mockImplementation(() => {
        calls.push('PATCH-ok');
        return Promise.resolve();
      });
    const complete = vi.fn().mockImplementation(() => {
      calls.push('COMPLETE');
      return Promise.resolve('done');
    });

    const autosave = createNotesAutosave({ save, delayMs: 100 });
    autosave.change('plan', 'ACT for 3 days');

    // First attempt fails and is abandoned before COMPLETE.
    await expect(flushThenComplete(autosave, complete)).rejects.toBeInstanceOf(NotesNotSavedError);
    expect(complete).not.toHaveBeenCalled();

    // The doctor presses retry; the save now succeeds.
    await expect(flushThenComplete(autosave, complete)).resolves.toBe('done');

    expect(calls).toEqual(['PATCH-failed', 'PATCH-ok', 'COMPLETE']);
    expect(autosave.dirtyFields()).toEqual([]);
    expect(autosave.status()).toBe('idle');
  });

  it('marks a terminal failure as terminal so the UI keeps its own banner', async () => {
    const save = vi.fn().mockRejectedValue(Object.assign(new Error('gone'), { status: 409 }));
    const complete = vi.fn().mockResolvedValue('done');

    const autosave = createNotesAutosave({ save, delayMs: 100 });
    autosave.change('assessment', 'Malaria');

    const error = await flushThenComplete(autosave, complete).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotesNotSavedError);
    expect((error as NotesNotSavedError).terminal).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  it('does not complete when text typed mid-save fails to persist', async () => {
    // The Phase 11.1 drain covers the happy path; this covers it failing.
    let releaseFirst: (() => void) | undefined;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockRejectedValue(new Error('network'));
    const complete = vi.fn().mockResolvedValue('done');

    const autosave = createNotesAutosave({ save, delayMs: 100 });
    autosave.change('assessment', 'Malaria');
    await vi.advanceTimersByTimeAsync(100);

    autosave.change('plan', 'ACT course'); // typed during the in-flight save
    const attempt = flushThenComplete(autosave, complete).catch((caught: unknown) => caught);
    releaseFirst?.();

    expect(await attempt).toBeInstanceOf(NotesNotSavedError);
    expect(complete).not.toHaveBeenCalled();
    expect(autosave.dirtyFields()).toEqual(['plan']);
  });
});

describe('canCompleteConsultation', () => {
  it.each<[string, Notes]>([
    ['nothing written', {}],
    ['assessment only', { assessment: 'Malaria' }],
    ['plan only', { plan: 'ACT course' }],
    ['whitespace plan', { assessment: 'Malaria', plan: '   ' }],
  ])('blocks completion with %s', (_label, notes) => {
    expect(canCompleteConsultation(notes)).toBe(false);
  });

  it('allows completion once assessment and plan are both written', () => {
    expect(canCompleteConsultation({ assessment: 'Malaria', plan: 'ACT course' })).toBe(true);
  });
});
