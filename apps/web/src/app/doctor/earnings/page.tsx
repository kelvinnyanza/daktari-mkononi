'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';

interface EarningRow {
  id: string;
  amountTzs: number;
  status: string;
  reference: string | null;
  createdAt: string;
}

interface EarningsResponse {
  items: EarningRow[];
  totalAmountTzs: number;
  page: number;
  pageSize: number;
  total: number;
}

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
  // Earnings accrue per completed consultation; payout execution is a later
  // phase, so PENDING here means "owed", not "failed".
  const pending = data.items
    .filter((row) => row.status === 'PENDING')
    .reduce((sum, row) => sum + row.amountTzs, 0);

  return (
    <>
      <PageHeader title={t('earnings.title')} subtitle={t('earnings.subtitle')} />

      <div className="mb-4 grid max-w-md gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{t('earnings.pendingTotal')}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTzs(pending)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">{t('earnings.amount')}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {formatTzs(data.totalAmountTzs)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="max-w-3xl">
        {data.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('earnings.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('earnings.date')}</TH>
                <TH>{t('earnings.amount')}</TH>
                <TH>{t('earnings.status')}</TH>
                <TH>{t('payments.reference')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((row) => (
                <TR key={row.id}>
                  <TD className="text-muted-foreground">{eatDateTimeLabel(row.createdAt)}</TD>
                  <TD className="font-medium tabular-nums">{formatTzs(row.amountTzs)}</TD>
                  <TD>
                    <Badge tone={row.status === 'COMPLETED' ? 'success' : 'neutral'}>
                      {row.status}
                    </Badge>
                  </TD>
                  <TD className="font-mono text-xs text-muted-foreground">{row.reference ?? '—'}</TD>
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
