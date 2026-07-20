'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DoctorDocumentField } from '@daktari/schemas';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label, Textarea } from '@/components/ui/input';
import { useI18nStore, useT, pickBilingual } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { TMC_REGISTER_URL } from '@/lib/config';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';
import { verificationStatusTone } from '@/lib/status';
import {
  effectiveStatus,
  evaluateDecision,
  isClaimedByMe,
  REQUIRED_DOCUMENT_FIELDS,
  type DocumentReviewStatus,
} from '@/lib/verification-rules';
import { useAuthStore } from '@/stores/auth';

interface ReviewDocumentView {
  document: DoctorDocumentField | null;
  type: string;
  fileName: string;
  reviewStatus: string;
  reviewNotes: string | null;
  uploadedAt: string;
  url: string;
}

interface DoctorDetail {
  doctorId: string;
  fullName: string;
  phone: string;
  tmcRegistrationNumber: string;
  specialty: string;
  subSpecialty: string | null;
  yearsOfExperience: number;
  consultationFeeTzs: number;
  region: string | null;
  verificationStatus: string;
  rejectionReason: string | null;
  suspensionReason: string | null;
  claimedByUserId: string | null;
  documents: ReviewDocumentView[];
  missingRequired: DoctorDocumentField[];
}

export default function VerificationDetailPage() {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const doctorId = params.id;
  const queryClient = useQueryClient();
  const adminUserId = useAuthStore((state) => state.user?.id ?? '');

  const [pendingReviews, setPendingReviews] = useState<
    Partial<Record<DoctorDocumentField, DocumentReviewStatus>>
  >({});
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [selected, setSelected] = useState<ReviewDocumentView | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['doctor-detail', doctorId],
    queryFn: () => api.get<DoctorDetail>(`/api/v1/doctors/admin/${doctorId}`),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['doctor-detail', doctorId] });
    await queryClient.invalidateQueries({ queryKey: ['verification-queue'] });
  };

  const claim = useMutation({
    mutationFn: () => api.post(`/api/v1/doctors/admin/${doctorId}/claim`),
    onSuccess: invalidate,
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      api.post(`/api/v1/doctors/admin/${doctorId}/decision`, {
        decision,
        // Only locally-changed document reviews are submitted; the server
        // applies them before evaluating the approval guard.
        perDocument: Object.entries(pendingReviews).map(([document, status]) => ({
          document,
          status,
        })),
        ...(decision === 'REJECTED' ? { notes: rejectionNotes.trim() } : {}),
      }),
    onSuccess: async () => {
      setPendingReviews({});
      setRejectionNotes('');
      setServerError(null);
      await invalidate();
      router.push('/admin/verification');
    },
    onError: (error) => {
      setServerError(
        error instanceof ApiError
          ? (pickBilingual(error.userMessage, locale) ?? error.code)
          : t('common.error'),
      );
    },
  });

  const suspend = useMutation({
    mutationFn: (reason: string) =>
      api.post(`/api/v1/doctors/admin/${doctorId}/suspend`, { reason }),
    onSuccess: invalidate,
    onError: (error) => {
      setServerError(
        error instanceof ApiError
          ? (pickBilingual(error.userMessage, locale) ?? error.code)
          : t('common.error'),
      );
    },
  });

  if (detail.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (detail.isError) {
    return <p className="text-sm text-destructive">{t('common.error')}</p>;
  }

  const doctor = detail.data;
  const context = {
    verificationStatus: doctor.verificationStatus,
    claimedByUserId: doctor.claimedByUserId,
    adminUserId,
    documents: doctor.documents,
    pendingReviews,
    rejectionNotes,
  };
  const availability = evaluateDecision(context);
  const claimed = isClaimedByMe(context);

  const setReview = (document: DoctorDocumentField, status: DocumentReviewStatus) => {
    setPendingReviews((current) => ({ ...current, [document]: status }));
  };

  return (
    <>
      <PageHeader title={doctor.fullName} subtitle={`${doctor.specialty} · ${doctor.phone}`} />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {/* TMC number first: it is the single most important thing to check. */}
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle>{t('verification.tmcNumber')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xl font-semibold tracking-wide">
                {doctor.tmcRegistrationNumber}
              </span>
              <a href={TMC_REGISTER_URL} target="_blank" rel="noreferrer noopener">
                <Button variant="outline" size="sm">
                  {t('verification.tmcVerify')} ↗
                </Button>
              </a>
              <p className="w-full text-xs text-muted-foreground">{t('verification.tmcHint')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('verification.documents')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {doctor.documents.map((document) => {
                const field = document.document;
                const status =
                  field === null ? 'PENDING' : effectiveStatus(field, context);
                const required = field !== null && REQUIRED_DOCUMENT_FIELDS.includes(field);
                return (
                  <div
                    key={document.type}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
                  >
                    <button
                      type="button"
                      className="text-sm underline underline-offset-2"
                      onClick={() => {
                        setSelected(document);
                      }}
                    >
                      {document.fileName}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {document.type}
                      {required ? ' *' : ''} · {eatDateTimeLabel(document.uploadedAt)}
                    </span>
                    <Badge
                      tone={
                        status === 'APPROVED' ? 'success' : status === 'REJECTED' ? 'danger' : 'neutral'
                      }
                      className="ml-auto"
                    >
                      {status === 'APPROVED'
                        ? t('verification.documentApproved')
                        : status === 'REJECTED'
                          ? t('verification.documentRejected')
                          : t('verification.documentPending')}
                    </Badge>
                    {field !== null && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!claimed}
                          onClick={() => {
                            setReview(field, 'APPROVED');
                          }}
                        >
                          {t('verification.documentApprove')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!claimed}
                          onClick={() => {
                            setReview(field, 'REJECTED');
                          }}
                        >
                          {t('verification.documentReject')}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {doctor.documents.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
              )}
            </CardContent>
          </Card>

          {/* Signed URLs expire in 15 minutes — the viewer is deliberately a
              plain iframe so PDFs and images both render without a plugin. */}
          {selected !== null && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{selected.fileName}</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelected(null);
                  }}
                >
                  {t('common.close')}
                </Button>
              </CardHeader>
              <CardContent>
                <iframe
                  title={selected.fileName}
                  src={selected.url}
                  className="h-[560px] w-full rounded-md border border-border bg-muted"
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t('verification.credentials')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Field label={t('doctors.status')}>
                <Badge tone={verificationStatusTone(doctor.verificationStatus)}>
                  {doctor.verificationStatus}
                </Badge>
              </Field>
              <Field label={t('verification.specialty')}>
                {doctor.specialty}
                {doctor.subSpecialty !== null ? ` · ${doctor.subSpecialty}` : ''}
              </Field>
              <Field label={t('verification.experience')}>{doctor.yearsOfExperience}</Field>
              <Field label={t('verification.fee')}>{formatTzs(doctor.consultationFeeTzs)}</Field>
              <Field label={t('verification.region')}>{doctor.region ?? '—'}</Field>
              {doctor.rejectionReason !== null && (
                <Field label={t('verification.reason')}>{doctor.rejectionReason}</Field>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('verification.decision')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {!claimed && (
                <Button
                  variant="outline"
                  disabled={claim.isPending || doctor.claimedByUserId !== null}
                  onClick={() => {
                    claim.mutate();
                  }}
                >
                  {doctor.claimedByUserId !== null
                    ? t('verification.claimedBy')
                    : t('verification.claim')}
                </Button>
              )}

              <div className="flex flex-col gap-1">
                <Label htmlFor="rejection-notes">{t('verification.reason')}</Label>
                <Textarea
                  id="rejection-notes"
                  value={rejectionNotes}
                  onChange={(event) => {
                    setRejectionNotes(event.target.value);
                  }}
                  placeholder={t('verification.reasonHint')}
                  disabled={!claimed}
                />
              </div>

              <Button
                disabled={!availability.canApprove || decide.isPending}
                onClick={() => {
                  decide.mutate('APPROVED');
                }}
              >
                {t('verification.decisionApprove')}
              </Button>
              {availability.approveBlockedBy !== null && (
                <p className="text-xs text-muted-foreground">
                  {t(availability.approveBlockedBy)}
                  {availability.approveBlockedBy === 'verification.blockedDocuments' &&
                    ` (${availability.unapprovedRequired.join(', ')})`}
                </p>
              )}

              <Button
                variant="destructive"
                disabled={!availability.canReject || decide.isPending}
                onClick={() => {
                  decide.mutate('REJECTED');
                }}
              >
                {t('verification.decisionReject')}
              </Button>
              {availability.rejectBlockedBy !== null && (
                <p className="text-xs text-muted-foreground">{t(availability.rejectBlockedBy)}</p>
              )}

              {serverError !== null && (
                <p role="alert" className="text-xs text-destructive">
                  {serverError}
                </p>
              )}
            </CardContent>
          </Card>

          {doctor.verificationStatus === 'APPROVED' && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle>{t('verification.suspend')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">{t('verification.suspendConfirm')}</p>
                <Button
                  variant="destructive"
                  disabled={rejectionNotes.trim().length < 10 || suspend.isPending}
                  onClick={() => {
                    suspend.mutate(rejectionNotes.trim());
                  }}
                >
                  {t('verification.suspend')}
                </Button>
                {rejectionNotes.trim().length < 10 && (
                  <p className="text-xs text-muted-foreground">{t('verification.blockedReason')}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
