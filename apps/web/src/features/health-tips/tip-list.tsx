'use client';

import { healthTipCategorySchema, healthTipStatusSchema, type HealthTipStatus } from '@daktari/schemas';
import Link from 'next/link';
import { useState } from 'react';
import { PaginatedTable, type Column } from '@/components/paginated-table';
import { Badge } from '@/components/ui/badge';
import { Input, Label, Select } from '@/components/ui/input';
import { useI18nStore, useT, type TranslationKey } from '@/i18n';
import { eatDateLabel } from '@/lib/eat';
import { illustrationSrc, STATUS_TONE, type AdminTipRow } from './types';

/**
 * Searchable, filterable tip list — shared by the admin page (all statuses)
 * and the doctor review page (defaults to Drafts).
 */
export function TipList({ basePath, defaultStatus }: { basePath: string; defaultStatus?: HealthTipStatus }) {
  const t = useT();
  const locale = useI18nStore((state) => state.locale);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>(defaultStatus ?? '');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);

  const filters = new URLSearchParams();
  if (q.trim().length > 0) filters.set('q', q.trim());
  if (status !== '') filters.set('status', status);
  if (category !== '') filters.set('category', category);
  const query = filters.toString();

  const columns: Column<AdminTipRow>[] = [
    {
      header: t('tips.col.title'),
      cell: (row) => (
        <Link href={`${basePath}/${row.id}`} className="flex items-center gap-3 font-medium hover:underline">
          <img src={illustrationSrc(row.illustration)} alt="" className="h-9 w-12 rounded bg-[#E3F3F0] object-contain" />
          <span>{locale === 'sw' ? row.titleSw : row.titleEn}</span>
        </Link>
      ),
    },
    { header: t('tips.col.category'), cell: (row) => t(`tips.category.${row.category}` as TranslationKey) },
    {
      header: t('tips.col.status'),
      cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t(`tips.status.${row.status}` as TranslationKey)}</Badge>,
    },
    { header: t('tips.col.reviewer'), cell: (row) => row.reviewedBy ?? '—' },
    { header: t('tips.col.priority'), cell: (row) => row.priority },
    { header: t('tips.col.updated'), cell: (row) => eatDateLabel(row.updatedAt) },
  ];

  const reset = (): void => setPage(1);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="tip-search">{t('tips.search')}</Label>
          <Input
            id="tip-search"
            className="w-64"
            placeholder={t('tips.searchPlaceholder')}
            value={q}
            onChange={(event) => {
              setQ(event.target.value);
              reset();
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tip-status">{t('tips.filter.status')}</Label>
          <Select
            id="tip-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              reset();
            }}
          >
            <option value="">{t('tips.filter.all')}</option>
            {healthTipStatusSchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`tips.status.${value}` as TranslationKey)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="tip-category">{t('tips.filter.category')}</Label>
          <Select
            id="tip-category"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              reset();
            }}
          >
            <option value="">{t('tips.filter.all')}</option>
            {healthTipCategorySchema.options.map((value) => (
              <option key={value} value={value}>
                {t(`tips.category.${value}` as TranslationKey)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <PaginatedTable<AdminTipRow>
        queryKey={['admin-health-tips', q, status, category]}
        path={`/api/v1/admin/health-tips${query === '' ? '' : `?${query}`}`}
        columns={columns}
        rowKey={(row) => row.id}
        page={page}
        onPageChange={setPage}
      />
    </>
  );
}
