'use client';

import { useParams } from 'next/navigation';
import { TipReview } from '@/features/health-tips/tip-editor';

export default function DoctorHealthTipReviewPage() {
  const params = useParams<{ id: string }>();
  return <TipReview id={params.id} basePath="/doctor/health-tips" />;
}
