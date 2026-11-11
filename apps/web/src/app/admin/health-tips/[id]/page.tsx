'use client';

import { useParams } from 'next/navigation';
import { TipEditor } from '@/features/health-tips/tip-editor';

/** /admin/health-tips/new creates a draft; /admin/health-tips/:id edits one. */
export default function AdminHealthTipEditorPage() {
  const params = useParams<{ id: string }>();
  return <TipEditor id={params.id === 'new' ? null : params.id} basePath="/admin/health-tips" />;
}
