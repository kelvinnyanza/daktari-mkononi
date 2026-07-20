/**
 * Debounced autosave for the five clinical note fields.
 *
 * Design constraints that shaped this:
 *  - A doctor types mid-consultation; a lost paragraph is a clinical record
 *    gone. So nothing is ever dropped: edits made *during* an in-flight save
 *    are re-queued and flushed after it resolves.
 *  - The server PATCHes a partial object into one encrypted blob, so we send
 *    only the fields that actually changed since the last confirmed save.
 *    Sending all five would re-encrypt (and re-audit) untouched text.
 *  - A *transient* failed save must not clear the dirty set — it stays dirty
 *    and is retried on the next tick, so a flaky connection self-heals.
 *  - A *terminal* failure (the consultation is no longer IN_PROGRESS, or this
 *    doctor may no longer write to it) must stop retrying immediately. Looping
 *    forever against a 409 buries the one thing the doctor needs to know: the
 *    text on their screen is not going to be saved. The unsaved fields are
 *    handed back so the UI can name them.
 *  - `flush()` is the pre-COMPLETE barrier: it must not resolve until every
 *    keystroke made before the call has actually reached the server, including
 *    ones typed *during* an in-flight save.
 *  - Timers are injected so tests drive the debounce deterministically instead
 *    of sleeping.
 */
export type NoteField =
  | 'chiefComplaint'
  | 'historyOfPresentIllness'
  | 'examination'
  | 'assessment'
  | 'plan';

export const NOTE_FIELDS: readonly NoteField[] = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'examination',
  'assessment',
  'plan',
];

export type Notes = Partial<Record<NoteField, string>>;

/**
 * What the status line shows. `stopped` is terminal: the server has refused
 * the write in a way that retrying cannot fix.
 */
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'error' | 'stopped';

/**
 * A save the server will keep refusing: the consultation left IN_PROGRESS
 * (409, e.g. it was completed or aborted in another tab) or this doctor is no
 * longer allowed to write to it (403). Everything else — network drops, 5xx —
 * is transient and keeps the self-healing retry.
 */
export function isTerminalSaveError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 409 || status === 403;
}

export interface AutosaveOptions {
  /** PATCHes the changed fields; rejects on failure. */
  save: (patch: Notes) => Promise<unknown>;
  /** Quiet period after the last keystroke. */
  delayMs?: number;
  onStatusChange?: (status: AutosaveStatus) => void;
  /** Override which failures are terminal (defaults to 409/403). */
  isTerminalError?: (error: unknown) => boolean;
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface NotesAutosave {
  /** Record an edit; schedules a save after the quiet period. */
  change: (field: NoteField, value: string) => void;
  /**
   * Drain everything pending and resolve only once it has all reached the
   * server. Used as the barrier before completing the consultation.
   */
  flush: () => Promise<void>;
  status: () => AutosaveStatus;
  /** Fields edited but not yet confirmed saved. */
  dirtyFields: () => NoteField[];
  /** Cancel any scheduled save (unmount). */
  dispose: () => void;
}

const DEFAULT_DELAY_MS = 800;

export function createNotesAutosave(options: AutosaveOptions): NotesAutosave {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const schedule = options.setTimeoutFn ?? ((handler, ms) => setTimeout(handler, ms));
  const unschedule = options.clearTimeoutFn ?? ((handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  });

  const isTerminal = options.isTerminalError ?? isTerminalSaveError;

  // The single source of truth for "not yet persisted": field → latest value.
  let dirty: Notes = {};
  let timer: unknown = null;
  /** The currently running drain, so flush() can await it instead of racing. */
  let draining: Promise<void> | null = null;
  let status: AutosaveStatus = 'idle';

  const setStatus = (next: AutosaveStatus): void => {
    if (status === next) return;
    status = next;
    options.onStatusChange?.(next);
  };

  const cancelTimer = (): void => {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
  };

  const startTimer = (): void => {
    cancelTimer();
    timer = schedule(() => {
      timer = null;
      void drain();
    }, delayMs);
  };

  /**
   * Save repeatedly until nothing is dirty, one request at a time.
   *
   * Concurrent callers share ONE drain promise: a `flush()` that arrives while
   * a save is in flight awaits that same loop rather than early-returning, so
   * it cannot resolve while an unsent keystroke is still queued. The loop
   * re-reads `dirty` each pass, which is what picks up text typed during the
   * previous await.
   */
  function drain(): Promise<void> {
    if (draining !== null) return draining;

    draining = (async () => {
      try {
        while (status !== 'stopped' && Object.keys(dirty).length > 0) {
          const patch = dirty;
          setStatus('saving');
          // Clear before awaiting so concurrent edits accumulate into a fresh
          // batch rather than being wiped by this save's completion.
          dirty = {};

          try {
            await options.save(patch);
          } catch (error) {
            // Put the unsaved values back, but never clobber a newer keystroke.
            dirty = { ...patch, ...dirty };
            if (isTerminal(error)) {
              // Retrying cannot help. Stop, and leave `dirty` populated so the
              // UI can tell the doctor exactly which fields were lost.
              cancelTimer();
              setStatus('stopped');
              return;
            }
            setStatus('error');
            startTimer(); // self-healing retry on the next quiet period
            return;
          }
        }
        if (status !== 'stopped') setStatus('idle');
      } finally {
        draining = null;
      }
    })();

    return draining;
  }

  return {
    change: (field, value) => {
      // A stopped autosave is dead for this consultation; further keystrokes
      // must not silently restart a loop that cannot succeed.
      if (status === 'stopped') return;
      dirty = { ...dirty, [field]: value };
      setStatus('pending');
      startTimer();
    },

    flush: async () => {
      cancelTimer();
      // Await the in-flight drain first: it may still be holding a batch AND
      // it will pick up anything typed during that batch. Then loop until the
      // queue is genuinely empty (or a save failed and set a non-idle status),
      // so no pre-flush keystroke can trigger a save after flush resolves.
      await drain();
      while (status !== 'stopped' && status !== 'error' && Object.keys(dirty).length > 0) {
        await drain();
      }
    },

    status: () => status,
    dirtyFields: () => Object.keys(dirty) as NoteField[],
    dispose: cancelTimer,
  };
}

/**
 * The server rejects fields shorter than 3 characters (`consultationNotesSchema`)
 * and requires at least one field, so an empty or too-short edit is held back
 * rather than fired off to produce a 400 the doctor cannot act on.
 */
export function savablePatch(patch: Notes): Notes {
  const out: Notes = {};
  for (const [field, value] of Object.entries(patch)) {
    if (value !== undefined && value.trim().length >= 3) {
      out[field as NoteField] = value;
    }
  }
  return out;
}

/** Completion guard, mirroring the server's COMPLETE precondition. */
export function canCompleteConsultation(notes: Notes): boolean {
  return (
    (notes.assessment?.trim().length ?? 0) >= 3 && (notes.plan?.trim().length ?? 0) >= 3
  );
}

/**
 * Raised when a flush finished without persisting everything, so COMPLETE was
 * never attempted. `terminal` distinguishes "the consultation is gone, this
 * text is lost" from "the network blipped, try again".
 */
export class NotesNotSavedError extends Error {
  constructor(
    readonly unsavedFields: NoteField[],
    readonly terminal: boolean,
  ) {
    super('clinical notes were not saved; consultation was not completed');
    this.name = 'NotesNotSavedError';
  }
}

/**
 * The only sanctioned path to COMPLETE.
 *
 * `flush()` resolving does NOT mean the notes are saved — on a transient
 * failure it returns with the fields still dirty and a self-healing retry
 * pending. Completing there would close the consultation, write the immutable
 * MedicalRecord, and accrue the doctor's earnings against notes that never
 * reached the server, with the text still on screen looking saved. Medical
 * records are immutable, so there is no correcting it afterwards — only a new
 * addendum record.
 *
 * So COMPLETE is issued only from a genuinely clean flush: status `idle` AND
 * nothing dirty. Anything else raises, and the caller offers a retry that
 * re-runs this whole sequence.
 */
export async function flushThenComplete<T>(
  autosave: NotesAutosave,
  complete: () => Promise<T>,
): Promise<T> {
  await autosave.flush();

  const status = autosave.status();
  const unsavedFields = autosave.dirtyFields();
  if (status !== 'idle' || unsavedFields.length > 0) {
    throw new NotesNotSavedError(unsavedFields, status === 'stopped');
  }

  return complete();
}
