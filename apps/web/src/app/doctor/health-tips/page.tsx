'use client';

import { PageHeader } from '@/components/portal-shell';
import { TipList } from '@/features/health-tips/tip-list';
import { useT } from '@/i18n';

/** Review queue for verified doctors — drafts first; the server enforces verification. */
export default function DoctorHealthTipsPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t('tips.reviewTitle')} subtitle={t('tips.reviewSubtitle')} />
      <TipList basePath="/doctor/health-tips" defaultStatus="DRAFT" />
    </>
  );
}
