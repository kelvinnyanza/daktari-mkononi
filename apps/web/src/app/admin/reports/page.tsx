'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { eatDateOf, formatTzs, shiftEatDate } from '@/lib/eat';

interface FinanceSummary {
  collectedTzs: number;
  collectedCount: number;
  collectedNotEarnedTzs: number;
  refundedTzs: number;
  refundedCount: number;
  commissionTzs: number;
  vatDueTzs: number;
  azamPayFeesTzs: number;
  azamPayFeesUnknownCount: number;
  doctorPayoutsTzs: number;
  doctorPayoutsViaAzamPayTzs: number;
  doctorPayoutsManualTzs: number;
  netPlatformRevenueTzs: number;
}

interface StatementRow {
  line: number;
  references: string[];
  amountTzs: number | null;
  status: string;
}

interface Reconciliation {
  period: { from: string | null; to: string | null };
  rows: number;
  matched: number;
  feesRecorded: number;
  inAzamPayNotOurs: StatementRow[];
  inOursNotAzamPay: Array<{ kind: string; id: string; reference: string | null; amountTzs: number }>;
  amountMismatches: Array<StatementRow & { kind: string; id: string; oursTzs: number }>;
  statusMismatches: Array<StatementRow & { kind: string; id: string; ours: string }>;
}

const METRICS: Array<keyof FinanceSummary> = [
  'collectedTzs',
  'refundedTzs',
  'commissionTzs',
  'vatDueTzs',
  'azamPayFeesTzs',
  'doctorPayoutsTzs',
  'netPlatformRevenueTzs',
];

/**
 * Finance totals for an EAT date range (computed by the server over every
 * row), CSV export, and AzamPay statement reconciliation. The statement is
 * read in the browser and sent as text; matching is done server-side.
 */
export default function AdminReportsPage() {
  const t = useT();
  const today = eatDateOf(new Date());
  const [from, setFrom] = useState(shiftEatDate(today, -6));
  const [to, setTo] = useState(today);
  const range = `from=${from}&to=${to}`;

  const summary = useQuery({
    queryKey: ['admin-finance', from, to],
    queryFn: () => api.get<FinanceSummary>(`/api/v1/admin/reports/finance?${range}`),
  });

  const download = useMutation({
    mutationFn: () => api.getText(`/api/v1/admin/reports/finance.csv?${range}`),
    onSuccess: (csv) => {
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `daktari-finance-${from}-${to}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    },
  });

  const [statement, setStatement] = useState<string | null>(null);
  const [statementName, setStatementName] = useState('');
  const [applyFees, setApplyFees] = useState(false);
  const reconcile = useMutation({
    mutationFn: () =>
      api.post<Reconciliation>('/api/v1/admin/reconciliation/azampay', { csv: statement, applyFees }),
  });

  return (
    <>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-from">{t('payments.from')}</Label>
          <Input
            id="report-from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-to">{t('payments.to')}</Label>
          <Input
            id="report-to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </div>
        <Button
          variant="outline"
          disabled={download.isPending}
          onClick={() => {
            download.mutate();
          }}
        >
          {t('reports.downloadCsv')}
        </Button>
      </div>

      {summary.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : summary.isError ? (
        <p className="text-sm text-destructive">
          {summary.error instanceof ApiError ? summary.error.message : t('common.error')}
        </p>
      ) : (
        <>
          <div className="mb-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {METRICS.map((metric) => (
              <Card key={metric}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{t(`reports.metric.${metric}` as TranslationKey)}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{formatTzs(summary.data[metric])}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <ul className="mb-6 list-disc pl-5 text-xs text-muted-foreground">
            <li>{t('reports.note.counts', { collected: summary.data.collectedCount, refunded: summary.data.refundedCount })}</li>
            {summary.data.collectedNotEarnedTzs > 0 && (
              <li>{t('reports.note.notEarned', { amount: formatTzs(summary.data.collectedNotEarnedTzs) })}</li>
            )}
            <li>
              {t('reports.note.payouts', {
                azampay: formatTzs(summary.data.doctorPayoutsViaAzamPayTzs),
                manual: formatTzs(summary.data.doctorPayoutsManualTzs),
              })}
            </li>
            {summary.data.azamPayFeesUnknownCount > 0 && (
              <li>{t('reports.note.feesUnknown', { count: summary.data.azamPayFeesUnknownCount })}</li>
            )}
            <li>{t('reports.note.net')}</li>
          </ul>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('reports.reconcile.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p className="text-xs text-muted-foreground">{t('reports.reconcile.hint')}</p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label={t('reports.reconcile.file')}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setStatementName(file.name);
              void file.text().then(setStatement);
            }}
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={applyFees}
              onChange={(event) => {
                setApplyFees(event.target.checked);
              }}
            />
            {t('reports.reconcile.applyFees')}
          </label>
          <Button
            className="self-start"
            disabled={statement === null || reconcile.isPending}
            onClick={() => {
              reconcile.mutate();
            }}
          >
            {t('reports.reconcile.run')} {statementName}
          </Button>
          {reconcile.isError && (
            <p className="text-destructive">
              {reconcile.error instanceof ApiError ? reconcile.error.message : t('common.error')}
            </p>
          )}
          {reconcile.data !== undefined && <ReconciliationResult result={reconcile.data} />}
        </CardContent>
      </Card>
    </>
  );
}

function ReconciliationResult({ result }: { result: Reconciliation }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <p>
        {t('reports.reconcile.summary', {
          rows: result.rows,
          matched: result.matched,
          fees: result.feesRecorded,
          from: result.period.from ?? '—',
          to: result.period.to ?? '—',
        })}
      </p>
      <Section title={t('reports.reconcile.inAzamPayNotOurs')} empty={result.inAzamPayNotOurs.length === 0}>
        {result.inAzamPayNotOurs.map((row) => (
          <TR key={row.line}>
            <TD>{row.line}</TD>
            <TD className="font-mono text-xs">{row.references.join(' · ')}</TD>
            <TD className="tabular-nums">{row.amountTzs === null ? '—' : formatTzs(row.amountTzs)}</TD>
            <TD>{row.status}</TD>
          </TR>
        ))}
      </Section>
      <Section title={t('reports.reconcile.inOursNotAzamPay')} empty={result.inOursNotAzamPay.length === 0}>
        {result.inOursNotAzamPay.map((row) => (
          <TR key={`${row.kind}-${row.id}`}>
            <TD>{row.kind}</TD>
            <TD className="font-mono text-xs">{row.reference ?? row.id}</TD>
            <TD className="tabular-nums">{formatTzs(row.amountTzs)}</TD>
            <TD />
          </TR>
        ))}
      </Section>
      <Section title={t('reports.reconcile.amountMismatches')} empty={result.amountMismatches.length === 0}>
        {result.amountMismatches.map((row) => (
          <TR key={row.line}>
            <TD>{row.line}</TD>
            <TD className="font-mono text-xs">{row.references.join(' · ')}</TD>
            <TD className="tabular-nums">
              {row.amountTzs === null ? '—' : formatTzs(row.amountTzs)} ≠ {formatTzs(row.oursTzs)}
            </TD>
            <TD>{row.kind}</TD>
          </TR>
        ))}
      </Section>
      <Section title={t('reports.reconcile.statusMismatches')} empty={result.statusMismatches.length === 0}>
        {result.statusMismatches.map((row) => (
          <TR key={row.line}>
            <TD>{row.line}</TD>
            <TD className="font-mono text-xs">{row.references.join(' · ')}</TD>
            <TD>
              {row.status} ≠ {row.ours}
            </TD>
            <TD>{row.kind}</TD>
          </TR>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  const t = useT();
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      {empty ? (
        <p className="text-xs text-muted-foreground">{t('reports.reconcile.none')}</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>#</TH>
              <TH>{t('payments.reference')}</TH>
              <TH>{t('payments.amount')}</TH>
              <TH />
            </TR>
          </THead>
          <TBody>{children}</TBody>
        </Table>
      )}
    </div>
  );
}
