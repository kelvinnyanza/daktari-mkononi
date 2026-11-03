'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { PayoutAccountCard } from '@/components/payout-account-card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pickBilingual, useI18nStore, useT, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { eatDateTimeLabel } from '@/lib/eat';
import { verificationStatusTone } from '@/lib/status';
import { uploadToPresignedTarget, type PresignedUploadTarget } from '@/lib/upload';

type DocumentField = 'tmc_cert' | 'degree' | 'id' | 'police_clearance';

/** Order shown to the doctor; police clearance is optional. */
const DOCUMENTS: ReadonlyArray<{ field: DocumentField; required: boolean }> = [
  { field: 'tmc_cert', required: true },
  { field: 'degree', required: true },
  { field: 'id', required: true },
  { field: 'police_clearance', required: false },
];

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp';

interface Verification {
  verificationStatus: string;
  rejectionReason: string | null;
  suspensionReason: string | null;
  documents: Array<{
    document: DocumentField | null;
    fileName: string;
    reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    reviewNotes: string | null;
    uploadedAt: string;
  }>;
  missingRequired: DocumentField[];
}

const REVIEW_TONE: Record<string, BadgeTone> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' };

/**
 * Doctor onboarding: verification status, the four documents (each uploaded
 * straight to storage through a presigned target, then checked by the API),
 * and the payout account. Admin review happens on /admin/verification.
 */
export default function DoctorOnboardingPage() {
  const t = useT();
  const verification = useQuery({
    queryKey: ['doctor-verification'],
    queryFn: () => api.get<Verification>('/api/v1/doctors/me/verification'),
  });

  const status = verification.data?.verificationStatus ?? null;
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t('onboarding.title')} />

      <Card>
        <CardHeader>
          <CardTitle>{t('onboarding.statusLabel')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {verification.isPending ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : verification.isError || status === null ? (
            <p className="text-destructive">{t('common.error')}</p>
          ) : (
            <>
              <div>
                <Badge tone={verificationStatusTone(status)}>
                  {t(`onboarding.status.${status}` as TranslationKey)}
                </Badge>
              </div>
              {status === 'REJECTED' && verification.data.rejectionReason !== null && (
                <p>{t('onboarding.rejectionReason', { reason: verification.data.rejectionReason })}</p>
              )}
              {status === 'SUSPENDED' && verification.data.suspensionReason !== null && (
                <p>{t('onboarding.rejectionReason', { reason: verification.data.suspensionReason })}</p>
              )}
              {status === 'APPROVED' && (
                <p className="flex items-center gap-2">
                  {t('onboarding.nextSteps')}
                  <Link href="/doctor/schedule" className="underline">
                    {t('onboarding.goSchedule')}
                  </Link>
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('onboarding.documentsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-muted-foreground">{t('onboarding.documentsHelp')}</p>
          {DOCUMENTS.map(({ field, required }) => (
            <DocumentRow
              key={field}
              field={field}
              required={required}
              current={verification.data?.documents.find((doc) => doc.document === field) ?? null}
              disabled={status === 'SUSPENDED'}
            />
          ))}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-1 text-sm font-semibold">{t('onboarding.payoutTitle')}</h2>
        <p className="mb-2 text-xs text-muted-foreground">{t('onboarding.payoutHelp')}</p>
        <PayoutAccountCard />
      </div>
    </div>
  );
}

function DocumentRow({
  field,
  required,
  current,
  disabled,
}: {
  field: DocumentField;
  required: boolean;
  current: Verification['documents'][number] | null;
  disabled: boolean;
}) {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // 1. Ask the API for a target (validates name, type, size).
      const target = await api.post<PresignedUploadTarget>('/api/v1/doctors/me/documents/upload-url', {
        document: field,
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      // 2. Send the bytes straight to storage (S3 / local upload route).
      await uploadToPresignedTarget(target, file, file.name);
      // 3. The API re-checks the stored file and records it.
      await api.post('/api/v1/doctors/me/documents/complete', { document: field, key: target.key, fileName: file.name });
    },
    onMutate: () => {
      setError(null);
    },
    onError: (caught) => {
      setError(
        caught instanceof ApiError
          ? (pickBilingual(caught.userMessage, locale) ?? t('onboarding.uploadFailed'))
          : t('onboarding.uploadFailed'),
      );
    },
    onSettled: async () => {
      if (input.current) input.current.value = '';
      await queryClient.invalidateQueries({ queryKey: ['doctor-verification'] });
    },
  });

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">{t(`onboarding.doc.${field}` as TranslationKey)}</span>
          {required && <Badge tone="neutral">{t('onboarding.doc.required')}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {current === null ? (
            <Badge tone="neutral">{t('onboarding.doc.missing')}</Badge>
          ) : (
            <Badge tone={REVIEW_TONE[current.reviewStatus] ?? 'neutral'}>
              {t(`onboarding.doc.review.${current.reviewStatus}` as TranslationKey)}
            </Badge>
          )}
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            aria-label={t(`onboarding.doc.${field}` as TranslationKey)}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
          <Button
            size="sm"
            variant={current === null ? 'default' : 'outline'}
            disabled={disabled || upload.isPending}
            onClick={() => input.current?.click()}
          >
            {upload.isPending ? t('onboarding.uploading') : current === null ? t('onboarding.upload') : t('onboarding.replace')}
          </Button>
        </div>
      </div>
      {current !== null && (
        <span className="text-xs text-muted-foreground">
          {current.fileName} · {eatDateTimeLabel(current.uploadedAt)}
        </span>
      )}
      {current?.reviewStatus === 'REJECTED' && current.reviewNotes !== null && (
        <span className="text-xs text-destructive">{t('onboarding.doc.notes', { notes: current.reviewNotes })}</span>
      )}
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
