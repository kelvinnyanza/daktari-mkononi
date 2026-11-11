'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/portal-shell';
import { Button } from '@/components/ui/button';
import { TipList } from '@/features/health-tips/tip-list';
import { useT } from '@/i18n';

/** "Vidokezo vya Afya" — list, search, filter; create / edit / review / publish / archive. */
export default function AdminHealthTipsPage() {
  const t = useT();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title={t('tips.title')} subtitle={t('tips.subtitle')} />
        <Link href="/admin/health-tips/new">
          <Button>{t('tips.new')}</Button>
        </Link>
      </div>
      <TipList basePath="/admin/health-tips" />
    </>
  );
}
