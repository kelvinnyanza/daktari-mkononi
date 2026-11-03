'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT, type TranslationKey } from '@/i18n';
import { api } from '@/lib/api';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';
import { PayoutAccountCard } from '@/components/payout-account-card';

interface EarningRow {
  id: string;
  amountTzs: number;
  status: string;
  kind: string;
  note: string | null;
  failureReason: string | null;
  reference: string | null;
  createdAt: string;
  /** Frozen split of the patient's payment (null on adjustments). */
  breakdown: {
    feeTzs: number;
    platformCommissionTzs: number;
    vatTzs: number;
    doctorAmountTzs: number;
  } | null;
}

interface EarningsResponse {
  items: EarningRow[];
  /** Server-side, over ALL rows — never summed from the page on screen. */
  totals: { pendingTzs: number; processingTzs: number; paidTzs: number; failedTzs: number; reversedTzs: number };
  page: number;
  pageSize: number;
  total: number;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  PAID: 'success',
  FAILED: 'danger',
  REVERSED: 'warning',
};

export default function DoctorEarningsPage() {
  const t = useT();
  const [page, setPage] = useState(1);

  const earnings = useQuery({
    queryKey: ['doctor-earnings', page],
    queryFn: () =>
      api.get<EarningsResponse>(`/api/v1/doctors/me/earnings?page=${page}&pageSize=25`),
  });

  if (earnings.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (earnings.isError) {
    return <p className="text-sm text-destructive">{t('common.error')}</p>;
  }

  const data = earnings.data;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <PageHeader title={t('earnings.title')} subtitle={t('earnings.subtitle')} />

      <div className="mb-4 grid max-w-3xl gap-4 sm:grid-cols-3">
        <Total label={t('earnings.pendingTotal')} value={data.totals.pendingTzs} hint={t('earnings.pendingHint')} />
        <Total label={t('earnings.processingTotal')} value={data.totals.processingTzs} hint={t('earnings.processingHint')} />
        <Total label={t('earnings.paidTotal')} value={data.totals.paidTzs} />
      </div>

      <PayoutAccountCard />

      <Card className="max-w-5xl">
        {data.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('earnings.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('earnings.date')}</TH>
                <TH>{t('earnings.fee')}</TH>
                <TH>{t('earnings.commission')}</TH>
                <TH>{t('earnings.vat')}</TH>
                <TH>{t('earnings.youReceive')}</TH>
                <TH>{t('earnings.status')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((row) => (
                <TR key={row.id}>
                  <TD className="text-muted-foreground">{eatDateTimeLabel(row.createdAt)}</TD>
                  <TD className="tabular-nums">
                    {row.breakdown !== null ? formatTzs(row.breakdown.feeTzs) : '—'}
                  </TD>
                  <TD className="tabular-nums text-muted-foreground">
                    {row.breakdown !== null ? `−${formatTzs(row.breakdown.platformCommissionTzs)}` : '—'}
                  </TD>
                  <TD className="tabular-nums text-muted-foreground">
                    {row.breakdown !== null ? `−${formatTzs(row.breakdown.vatTzs)}` : '—'}
                  </TD>
                  <TD className="font-medium tabular-nums">{formatTzs(row.amountTzs)}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
                      {t(`earnings.status.${row.status}` as TranslationKey)}
                    </Badge>
                    {row.kind === 'ADJUSTMENT' && (
                      <span className="ml-2 text-xs text-muted-foreground">{t('earnings.adjustment')}</span>
                    )}
                    {row.failureReason !== null && row.status === 'FAILED' && (
                      <p className="mt-1 text-xs text-muted-foreground">{t('earnings.failedHint')}</p>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <div className="flex items-center justify-between border-t border-border p-3 text-xs">
          <span className="text-muted-foreground">{t('common.page', { page, pages })}</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => {
                setPage((current) => current - 1);
              }}
            >
              {t('common.previous')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= pages}
              onClick={() => {
                setPage((current) => current + 1);
              }}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

function Total({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTzs(value)}</p>
        {hint !== undefined && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

