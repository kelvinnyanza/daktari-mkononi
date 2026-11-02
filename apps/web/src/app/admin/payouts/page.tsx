'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';

interface PreviewRow {
  doctorId: string;
  doctorName: string | null;
  netTzs: number;
  earningsCount: number;
  accountStatus: string | null;
  automaticPayout: boolean;
  eligible: boolean;
  reason: 'OK' | 'NO_ACCOUNT' | 'ACCOUNT_NOT_VERIFIED' | 'BELOW_MINIMUM';
}

interface Run {
  id: string;
  status: 'DRAFT' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED';
  cutoff: string;
  totalTzs: number;
  itemCount: number;
  note: string | null;
  createdAt: string;
  approvedAt: string | null;
}

interface RunItem {
  id: string;
  doctorName: string | null;
  amountTzs: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
  attempt: number;
  providerReference: string | null;
  failureReason: string | null;
  method: string | null;
  manualReference: string | null;
  account: { operator: string | null; bankName: string | null; accountNumberMasked: string; name: string | null; automaticPayout: boolean } | null;
}

const RUN_TONE: Record<Run['status'], BadgeTone> = {
  DRAFT: 'neutral',
  PROCESSING: 'info',
  COMPLETED: 'success',
  CANCELLED: 'warning',
};
const ITEM_TONE: Record<RunItem['status'], BadgeTone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  PAID: 'success',
  FAILED: 'danger',
};

/** EAT end-of-day for a yyyy-mm-dd input, as a UTC ISO string. */
function eatEndOfDay(date: string): string {
  return new Date(`${date}T23:59:59+03:00`).toISOString();
}

/**
 * Admin payout runs. The SERVER owns every money rule (eligibility, minimum,
 * reservation, no double payment); this screen only shows the preview it
 * computes and sends explicit admin decisions (create / approve / cancel /
 * retry / mark paid with reference).
 */
export default function AdminPayoutsPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const [cutoffDate, setCutoffDate] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const cutoffParam = cutoffDate === '' ? '' : `?cutoff=${encodeURIComponent(eatEndOfDay(cutoffDate))}`;

  const preview = useQuery({
    queryKey: ['admin-payout-preview', cutoffDate],
    queryFn: () =>
      api.get<{ rows: PreviewRow[]; eligibleTotalTzs: number; minPayoutTzs: number; cutoff: string }>(
        `/api/v1/admin/payouts/preview${cutoffParam}`,
      ),
  });
  const runs = useQuery({
    queryKey: ['admin-payout-runs'],
    queryFn: () => api.get<{ items: Run[] }>('/api/v1/admin/payouts'),
  });

  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['admin-payout-preview'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-payout-runs'] });
    await queryClient.invalidateQueries({ queryKey: ['admin-payout-run'] });
  };
  const create = useMutation({
    mutationFn: () =>
      api.post<Run>('/api/v1/admin/payouts', cutoffDate === '' ? {} : { cutoff: eatEndOfDay(cutoffDate) }),
    onSuccess: async (run) => {
      setSelected(run.id);
      await invalidate();
    },
  });

  return (
    <>
      <PageHeader title={t('payouts.title')} subtitle={t('payouts.subtitle')} />

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('payouts.preview')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="cutoff">{t('payouts.cutoff')}</Label>
                <Input
                  id="cutoff"
                  type="date"
                  value={cutoffDate}
                  onChange={(event) => {
                    setCutoffDate(event.target.value);
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{t('payouts.cutoffHint')}</p>
            </div>
            {preview.isPending ? (
              <p className="text-muted-foreground">{t('common.loading')}</p>
            ) : preview.isError ? (
              <p className="text-destructive">{t('common.error')}</p>
            ) : preview.data.rows.length === 0 ? (
              <p className="text-muted-foreground">{t('payouts.nothingOwed')}</p>
            ) : (
              <>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('payouts.doctor')}</TH>
                      <TH>{t('payouts.owed')}</TH>
                      <TH>{t('payouts.eligibility')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {preview.data.rows.map((row) => (
                      <TR key={row.doctorId}>
                        <TD>
                          {row.doctorName ?? row.doctorId}
                          <span className="ml-1 text-xs text-muted-foreground">({row.earningsCount})</span>
                        </TD>
                        <TD className="tabular-nums">{formatTzs(row.netTzs)}</TD>
                        <TD>
                          <Badge tone={row.eligible ? 'success' : 'warning'}>
                            {t(`payouts.reason.${row.reason}` as TranslationKey)}
                          </Badge>
                          {row.eligible && !row.automaticPayout && (
                            <span className="ml-2 text-xs text-muted-foreground">{t('payouts.manual')}</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <p>
                  {t('payouts.eligibleTotal')}:{' '}
                  <span className="font-semibold tabular-nums">{formatTzs(preview.data.eligibleTotalTzs)}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    ({t('payouts.minimum')} {formatTzs(preview.data.minPayoutTzs)})
                  </span>
                </p>
                <Button
                  className="self-start"
                  disabled={preview.data.eligibleTotalTzs <= 0 || create.isPending}
                  onClick={() => {
                    create.mutate();
                  }}
                >
                  {t('payouts.createDraft')}
                </Button>
                {create.isError && (
                  <p className="text-destructive">
                    {create.error instanceof ApiError ? create.error.message : t('common.error')}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('payouts.runs')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {runs.data === undefined ? (
              <p className="text-muted-foreground">{t('common.loading')}</p>
            ) : runs.data.items.length === 0 ? (
              <p className="text-muted-foreground">{t('payouts.noRuns')}</p>
            ) : (
              runs.data.items.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={`flex items-center justify-between rounded-md border p-2 text-left ${
                    selected === run.id ? 'border-primary' : 'border-border'
                  }`}
                  onClick={() => {
                    setSelected(run.id);
                  }}
                >
                  <span>
                    {eatDateTimeLabel(run.createdAt)} · {run.itemCount} · {formatTzs(run.totalTzs)}
                  </span>
                  <Badge tone={RUN_TONE[run.status]}>{t(`payouts.runStatus.${run.status}` as TranslationKey)}</Badge>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {selected !== null && <RunDetail runId={selected} onChanged={invalidate} />}
        <AccountsToVerify />
      </div>
    </>
  );
}

function RunDetail({ runId, onChanged }: { runId: string; onChanged: () => Promise<void> }) {
  const t = useT();
  const run = useQuery({
    queryKey: ['admin-payout-run', runId],
    queryFn: () => api.get<Run & { items: RunItem[] }>(`/api/v1/admin/payouts/${runId}`),
  });
  const [manual, setManual] = useState<Record<string, { reference: string; note: string }>>({});
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(path, body),
    onSuccess: onChanged,
  });

  if (run.data === undefined) {
    return (
      <Card className="xl:col-span-2">
        <CardContent className="pt-4 text-sm text-muted-foreground">{t('common.loading')}</CardContent>
      </Card>
    );
  }
  const data = run.data;
  return (
    <Card className="xl:col-span-2">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>
          {formatTzs(data.totalTzs)} · {data.itemCount} ·{' '}
          <Badge tone={RUN_TONE[data.status]}>{t(`payouts.runStatus.${data.status}` as TranslationKey)}</Badge>
        </CardTitle>
        {data.status === 'DRAFT' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => {
                if (window.confirm(t('payouts.approveConfirm', { total: formatTzs(data.totalTzs) }))) {
                  action.mutate({ path: `/api/v1/admin/payouts/${runId}/approve` });
                }
              }}
            >
              {t('payouts.approve')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={action.isPending}
              onClick={() => {
                action.mutate({ path: `/api/v1/admin/payouts/${runId}/cancel` });
              }}
            >
              {t('payouts.cancel')}
            </Button>
          </div>
        )}
      </CardHeader>
      <Table>
        <THead>
          <TR>
            <TH>{t('payouts.doctor')}</TH>
            <TH>{t('payouts.account')}</TH>
            <TH>{t('payouts.amount')}</TH>
            <TH>{t('payouts.status')}</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {data.items.map((item) => {
            const entry = manual[item.id] ?? { reference: '', note: '' };
            const canMarkPaid = item.status === 'FAILED' || (item.status === 'PROCESSING' && item.providerReference === null);
            return (
              <TR key={item.id}>
                <TD>{item.doctorName ?? '—'}</TD>
                <TD className="text-xs">
                  {item.account === null
                    ? '—'
                    : `${item.account.operator ?? item.account.bankName ?? ''} ${item.account.accountNumberMasked} ${item.account.name ?? ''}`}
                </TD>
                <TD className="tabular-nums">{formatTzs(item.amountTzs)}</TD>
                <TD>
                  <Badge tone={ITEM_TONE[item.status]}>{item.status}</Badge>
                  {item.attempt > 1 && <span className="ml-1 text-xs text-muted-foreground">×{item.attempt}</span>}
                  {item.failureReason !== null && <p className="mt-1 text-xs text-destructive">{item.failureReason}</p>}
                  {item.manualReference !== null && (
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.manualReference}</p>
                  )}
                  {item.status === 'PROCESSING' && item.providerReference === null && (
                    <p className="mt-1 text-xs text-muted-foreground">{t('payouts.outcomeUnknown')}</p>
                  )}
                </TD>
                <TD className="min-w-[220px]">
                  {item.status === 'FAILED' && item.account?.automaticPayout === true && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mb-2"
                      disabled={action.isPending}
                      onClick={() => {
                        action.mutate({ path: `/api/v1/admin/payouts/items/${item.id}/retry` });
                      }}
                    >
                      {t('payouts.retry')}
                    </Button>
                  )}
                  {canMarkPaid && data.status !== 'DRAFT' && (
                    <div className="flex flex-col gap-1">
                      <Input
                        aria-label={t('payouts.manualReference')}
                        placeholder={t('payouts.manualReference')}
                        value={entry.reference}
                        onChange={(event) => {
                          setManual((current) => ({ ...current, [item.id]: { ...entry, reference: event.target.value } }));
                        }}
                      />
                      <Input
                        aria-label={t('payouts.manualNote')}
                        placeholder={t('payouts.manualNote')}
                        value={entry.note}
                        onChange={(event) => {
                          setManual((current) => ({ ...current, [item.id]: { ...entry, note: event.target.value } }));
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={entry.reference.trim().length < 3 || entry.note.trim().length < 3 || action.isPending}
                        onClick={() => {
                          action.mutate({
                            path: `/api/v1/admin/payouts/items/${item.id}/mark-paid`,
                            body: { reference: entry.reference.trim(), note: entry.note.trim() },
                          });
                        }}
                      >
                        {t('payouts.markPaid')}
                      </Button>
                    </div>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      {action.isError && (
        <p className="p-3 text-sm text-destructive">
          {action.error instanceof ApiError ? action.error.message : t('common.error')}
        </p>
      )}
    </Card>
  );
}

function AccountsToVerify() {
  const t = useT();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const accounts = useQuery({
    queryKey: ['admin-payout-accounts-review'],
    queryFn: () =>
      api.get<{
        items: Array<{ doctorId: string; doctorName: string | null; type: string; operator: string | null; bankName: string | null; accountNumberMasked: string; accountName: string | null }>;
      }>('/api/v1/admin/payout-accounts/review'),
  });
  const verify = useMutation({
    mutationFn: ({ doctorId, note }: { doctorId: string; note: string }) =>
      api.post(`/api/v1/admin/payout-accounts/${doctorId}/verify`, { note }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-payout-accounts-review'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-payout-preview'] });
    },
  });
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>{t('payouts.accountsToVerify')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {accounts.data === undefined ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : accounts.data.items.length === 0 ? (
          <p className="text-muted-foreground">{t('payouts.noAccountsToVerify')}</p>
        ) : (
          accounts.data.items.map((account) => {
            const note = notes[account.doctorId] ?? '';
            return (
              <div key={account.doctorId} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                <span className="font-medium">{account.doctorName ?? account.doctorId}</span>
                <span className="text-xs">
                  {account.operator ?? account.bankName} {account.accountNumberMasked} {account.accountName ?? ''}
                </span>
                <Input
                  className="max-w-xs"
                  aria-label={t('payouts.verifyNote')}
                  placeholder={t('payouts.verifyNote')}
                  value={note}
                  onChange={(event) => {
                    setNotes((current) => ({ ...current, [account.doctorId]: event.target.value }));
                  }}
                />
                <Button
                  size="sm"
                  disabled={note.trim().length < 3 || verify.isPending}
                  onClick={() => {
                    verify.mutate({ doctorId: account.doctorId, note: note.trim() });
                  }}
                >
                  {t('payouts.verify')}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
