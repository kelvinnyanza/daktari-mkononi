'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { ChatPanel } from '@/features/consultation/chat-panel';
import {
  canCompleteConsultation,
  createNotesAutosave,
  flushThenComplete,
  NOTE_FIELDS,
  NotesNotSavedError,
  savablePatch,
  type AutosaveStatus,
  type NoteField,
  type Notes,
  type NotesAutosave,
} from '@/features/consultation/notes-autosave';
import { VideoPanel } from '@/features/consultation/video-panel';
import { useI18nStore, useT, pickBilingual } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { triageTone } from '@/lib/status';
import { useAuthStore } from '@/stores/auth';

interface Diagnosis {
  id: string;
  icd10Code: string;
  description: string;
  type: 'PRIMARY' | 'SECONDARY' | 'DIFFERENTIAL';
}

interface ConsultationView {
  id: string;
  appointmentId: string;
  status: string;
  startedAt: string;
  videoRoomUrl: string | null;
  diagnoses: Diagnosis[];
  notes?: Notes;
}

interface PatientContext {
  ageBand: string;
  gender: string;
  bloodType: string | null;
  chronicConditions: string[];
  allergies: string[];
  currentMedications: string[];
  screening: {
    triageLevel: string | null;
    urgencyScore: number | null;
    transcript: Array<{ role: string; content: string }>;
  } | null;
}

const ICD10_PATTERN = /^[A-TV-Z]\d{2}(\.\d{1,2})?$/;

export default function ConsultationWorkspacePage() {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const consultationId = params.id;
  const queryClient = useQueryClient();
  const selfUserId = useAuthStore((state) => state.user?.id ?? '');

  const [notes, setNotes] = useState<Notes>({});
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [lostFields, setLostFields] = useState<NoteField[]>([]);
  /** A completion attempt was abandoned because the notes had not saved. */
  const [notesUnsaved, setNotesUnsaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [abortReason, setAbortReason] = useState('');
  const [icd10Code, setIcd10Code] = useState('');
  const [description, setDescription] = useState('');
  const [diagnosisType, setDiagnosisType] = useState<Diagnosis['type']>('SECONDARY');
  const hydrated = useRef(false);

  const consultation = useQuery({
    queryKey: ['consultation', consultationId],
    queryFn: () => api.get<ConsultationView>(`/api/v1/consultations/${consultationId}`),
  });

  const context = useQuery({
    queryKey: ['consultation-context', consultationId],
    queryFn: () => api.get<PatientContext>(`/api/v1/consultations/${consultationId}/patient-context`),
  });

  // Seed the editor once; later refetches must never stomp on live typing.
  useEffect(() => {
    if (consultation.data !== undefined && !hydrated.current) {
      hydrated.current = true;
      setNotes(consultation.data.notes ?? {});
    }
  }, [consultation.data]);

  const autosave = useMemo(() => {
    const controller: NotesAutosave = createNotesAutosave({
      save: async (patch) => {
        const body = savablePatch(patch);
        if (Object.keys(body).length === 0) return;
        await api.patch(`/api/v1/consultations/${consultationId}/notes`, body);
      },
      onStatusChange: (next) => {
        setAutosaveStatus(next);
        // Terminal: name the fields that will not be saved so the doctor can
        // copy them somewhere before leaving the screen.
        setLostFields(next === 'stopped' ? controller.dirtyFields() : []);
      },
    });
    return controller;
  }, [consultationId]);

  useEffect(() => () => { autosave.dispose(); }, [autosave]);

  const onNoteChange = (field: NoteField, value: string): void => {
    setNotes((current) => ({ ...current, [field]: value }));
    autosave.change(field, value);
  };

  const onError = (error: unknown) => {
    setActionError(
      error instanceof ApiError
        ? (pickBilingual(error.userMessage, locale) ?? error.code)
        : t('common.error'),
    );
  };

  const addDiagnosis = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/consultations/${consultationId}/diagnoses`, {
        icd10Code: icd10Code.trim().toUpperCase(),
        description: description.trim(),
        type: diagnosisType,
      }),
    onSuccess: async () => {
      setIcd10Code('');
      setDescription('');
      setDiagnosisType('SECONDARY');
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['consultation', consultationId] });
    },
    onError,
  });

  const removeDiagnosis = useMutation({
    mutationFn: (diagnosisId: string) =>
      api.delete(`/api/v1/consultations/${consultationId}/diagnoses/${diagnosisId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['consultation', consultationId] }),
    onError,
  });

  const complete = useMutation({
    // flushThenComplete issues COMPLETE only from a clean flush — see its
    // doc comment for why completing on unsaved notes is unrecoverable.
    mutationFn: () =>
      flushThenComplete(autosave, () =>
        api.post(`/api/v1/consultations/${consultationId}/complete`),
      ),
    onSuccess: () => {
      setNotesUnsaved(false);
      router.push('/doctor/today');
    },
    onError: (error) => {
      if (error instanceof NotesNotSavedError) {
        // Not a server rejection: COMPLETE was never sent. A `stopped`
        // autosave already has its own banner and a disabled button, so only
        // the transient case gets the retry prompt.
        setNotesUnsaved(!error.terminal);
        setLostFields(error.unsavedFields);
        return;
      }
      onError(error);
    },
  });

  const abort = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/api/v1/consultations/${consultationId}/abort`, { reason }),
    onSuccess: () => {
      router.push('/doctor/today');
    },
    onError,
  });

  if (consultation.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (consultation.isError) {
    return <p className="text-sm text-destructive">{t('common.error')}</p>;
  }

  const data = consultation.data;
  const hasPrimary = data.diagnoses.some((diagnosis) => diagnosis.type === 'PRIMARY');
  const icdValid = ICD10_PATTERN.test(icd10Code.trim().toUpperCase());
  // The server allows exactly one PRIMARY diagnosis — block the second here
  // rather than letting the doctor discover it via a 409.
  const primaryBlocked = diagnosisType === 'PRIMARY' && hasPrimary;
  const canAddDiagnosis = icdValid && description.trim().length >= 3 && !primaryBlocked;
  const completable = canCompleteConsultation(notes);

  return (
    <div className="grid gap-4 xl:grid-cols-[300px_1fr_340px]">
      {/* ── Left: patient context ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('consultation.patientContext')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {context.isPending ? (
              <p className="text-muted-foreground">{t('common.loading')}</p>
            ) : context.isError ? (
              <p className="text-destructive">{t('common.error')}</p>
            ) : (
              <>
                {/* Age BAND, never the date of birth — the server never sends it. */}
                <ContextRow label={t('consultation.ageBand')} value={context.data.ageBand} />
                <ContextRow label={t('consultation.gender')} value={context.data.gender} />
                <ContextRow
                  label={t('consultation.bloodType')}
                  value={context.data.bloodType ?? '—'}
                />
                <ContextList
                  label={t('consultation.chronic')}
                  values={context.data.chronicConditions}
                  empty={t('common.none')}
                />
                <ContextList
                  label={t('consultation.allergies')}
                  values={context.data.allergies}
                  empty={t('common.none')}
                />
                <ContextList
                  label={t('consultation.medications')}
                  values={context.data.currentMedications}
                  empty={t('common.none')}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('consultation.screening')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {context.data?.screening == null ? (
              <p className="text-sm text-muted-foreground">{t('consultation.screeningNone')}</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {t('consultation.triageLevel')}
                  </span>
                  <Badge tone={triageTone(context.data.screening.triageLevel ?? '')}>
                    {context.data.screening.triageLevel ?? '—'}
                  </Badge>
                  {context.data.screening.urgencyScore !== null && (
                    <span className="text-xs text-muted-foreground">
                      {context.data.screening.urgencyScore}/10
                    </span>
                  )}
                </div>
                {/* The transcript is decrypted server-side and PHI-audited on
                    every read — it is the patient's own words, verbatim. */}
                <div className="max-h-72 overflow-y-auto rounded-md border border-border p-2">
                  {context.data.screening.transcript.map((entry, index) => (
                    <p key={index} className="mb-2 text-xs last:mb-0">
                      <span className="font-medium uppercase text-muted-foreground">
                        {entry.role}
                      </span>
                      <br />
                      {entry.content}
                    </p>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Centre: clinical notes + diagnoses ────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t('consultation.notes')}</CardTitle>
            <span
              className={
                autosaveStatus === 'error'
                  ? 'text-xs text-destructive'
                  : 'text-xs text-muted-foreground'
              }
              role="status"
            >
              {autosaveStatus === 'idle'
                ? t('consultation.autosaveIdle')
                : autosaveStatus === 'stopped'
                  ? t('consultation.autosaveStopped')
                  : autosaveStatus === 'error'
                    ? t('consultation.autosaveError')
                    : t('consultation.autosaveDirty')}
            </span>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* Terminal failure: the consultation moved on (completed or
                aborted elsewhere), so these fields are never going to save.
                Say so loudly and name them — the text is still on screen and
                the doctor can copy it before navigating away. */}
            {autosaveStatus === 'stopped' && (
              <p
                role="alert"
                className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive"
              >
                {t('consultation.autosaveStoppedDetail', {
                  fields: lostFields
                    .map((field) => t(`consultation.${field}` as TranslationKey))
                    .join(', '),
                })}
              </p>
            )}
            {NOTE_FIELDS.map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <Label htmlFor={field}>{t(`consultation.${field}` as TranslationKey)}</Label>
                <Textarea
                  id={field}
                  value={notes[field] ?? ''}
                  onChange={(event) => {
                    onNoteChange(field, event.target.value);
                  }}
                  className={field === 'chiefComplaint' ? 'min-h-[60px]' : 'min-h-[100px]'}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('consultation.diagnoses')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.diagnoses.map((diagnosis) => (
              <div
                key={diagnosis.id}
                className="flex items-center gap-2 rounded-md border border-border p-2 text-sm"
              >
                <span className="font-mono font-medium">{diagnosis.icd10Code}</span>
                <span>{diagnosis.description}</span>
                <Badge tone={diagnosis.type === 'PRIMARY' ? 'info' : 'neutral'} className="ml-auto">
                  {diagnosis.type}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    removeDiagnosis.mutate(diagnosis.id);
                  }}
                >
                  {t('schedule.removeBreak')}
                </Button>
              </div>
            ))}

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="icd10">{t('consultation.icdCode')}</Label>
                <Input
                  id="icd10"
                  className="w-28 font-mono uppercase"
                  value={icd10Code}
                  onChange={(event) => {
                    setIcd10Code(event.target.value);
                  }}
                  placeholder="B50.9"
                />
              </div>
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <Label htmlFor="diagnosis-description">{t('consultation.description')}</Label>
                <Input
                  id="diagnosis-description"
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="diagnosis-type">{t('consultation.primary')}</Label>
                <Select
                  id="diagnosis-type"
                  className="w-40"
                  value={diagnosisType}
                  onChange={(event) => {
                    setDiagnosisType(event.target.value as Diagnosis['type']);
                  }}
                >
                  <option value="PRIMARY">PRIMARY</option>
                  <option value="SECONDARY">SECONDARY</option>
                  <option value="DIFFERENTIAL">DIFFERENTIAL</option>
                </Select>
              </div>
              <Button
                disabled={!canAddDiagnosis || addDiagnosis.isPending}
                onClick={() => {
                  addDiagnosis.mutate();
                }}
              >
                {t('consultation.addDiagnosis')}
              </Button>
            </div>

            {icd10Code.trim() !== '' && !icdValid && (
              <p className="text-xs text-destructive">{t('consultation.icdInvalid')}</p>
            )}
            {primaryBlocked && (
              <p className="text-xs text-destructive">{t('consultation.primaryOnlyOne')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!completable || autosaveStatus === 'stopped' || complete.isPending}
                onClick={() => {
                  complete.mutate();
                }}
              >
                {t('consultation.complete')}
              </Button>
              {!completable && (
                <span className="text-xs text-muted-foreground">
                  {t('consultation.completeBlocked')}
                </span>
              )}
            </div>

            {/* The consultation was NOT completed: the notes had not reached
                the server, so we stopped rather than close the record around
                text that only exists in this browser. Retrying re-runs the
                whole flush-then-complete sequence. */}
            {notesUnsaved && (
              <div
                role="alert"
                className="flex flex-col gap-2 rounded-md border border-destructive bg-destructive/10 p-2"
              >
                <p className="text-xs text-destructive">
                  {t('consultation.completeNotesUnsaved', {
                    fields: lostFields
                      .map((field) => t(`consultation.${field}` as TranslationKey))
                      .join(', '),
                  })}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={complete.isPending}
                  onClick={() => {
                    setNotesUnsaved(false);
                    complete.mutate();
                  }}
                >
                  {t('common.retry')}
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <Label htmlFor="abort-reason">{t('consultation.abortReason')}</Label>
              <Input
                id="abort-reason"
                value={abortReason}
                onChange={(event) => {
                  setAbortReason(event.target.value);
                }}
              />
              {/* The appointment can be restarted exactly once after an abort;
                  the server enforces the restart-once rule. */}
              <p className="text-xs text-muted-foreground">{t('consultation.abortHint')}</p>
              <Button
                variant="destructive"
                className="self-start"
                disabled={abortReason.trim().length < 3 || abort.isPending}
                onClick={() => {
                  abort.mutate(abortReason.trim());
                }}
              >
                {t('consultation.abort')}
              </Button>
            </div>

            {actionError !== null && (
              <p role="alert" className="text-xs text-destructive">
                {actionError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Right: video + chat ───────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {data.videoRoomUrl !== null && (
          <Card>
            <CardHeader>
              <CardTitle>{t('consultation.video')}</CardTitle>
            </CardHeader>
            <CardContent>
              <VideoPanel consultationId={consultationId} />
            </CardContent>
          </Card>
        )}

        <ChatPanel consultationId={consultationId} selfUserId={selfUserId} />
      </div>
    </div>
  );
}

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ContextList({
  label,
  values,
  empty,
}: {
  label: string;
  values: string[];
  empty: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span>{values.length === 0 ? empty : values.join(', ')}</span>
    </div>
  );
}
