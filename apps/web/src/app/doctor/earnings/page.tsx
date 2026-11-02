'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';

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

interface PayoutAccount {
  type: 'MOBILE_MONEY' | 'BANK';
  operator: string | null;
  bankName: string | null;
  accountNumberMasked: string;
  lookupName: string | null;
  status: 'NAME_PENDING_CONFIRMATION' | 'LOOKUP_FAILED' | 'VERIFIED';
  automaticPayout: boolean;
}

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'neutral',
  PROCESSING: 'info',
  PAID: 'success',
  FAILED: 'danger',
  REVERSED: 'warning',
};

const OPERATORS = ['MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'HALOPESA', 'AZAMPESA'] as const;

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

/**
 * Where payouts are sent. Saving looks the holder up with AzamPay; the
 * doctor must confirm the returned name before the account is used. Any
 * change re-verifies (server-enforced, audited).
 */
function PayoutAccountCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ['payout-account'],
    queryFn: () => api.get<{ account: PayoutAccount | null }>('/api/v1/doctors/me/payout-account'),
  });
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState<'MOBILE_MONEY' | 'BANK'>('MOBILE_MONEY');
  const [operator, setOperator] = useState<string>('MPESA');
  const [accountNumber, setAccountNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['payout-account'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api.put(
        '/api/v1/doctors/me/payout-account',
        type === 'MOBILE_MONEY'
          ? { type, operator, accountNumber }
          : { type, bankName, accountNumber, accountName },
      ),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const confirm = useMutation({
    mutationFn: (confirmedName: string) =>
      api.post('/api/v1/doctors/me/payout-account/confirm', { confirmedName }),
    onSuccess: refresh,
  });
  const lookup = useMutation({
    mutationFn: () => api.post('/api/v1/doctors/me/payout-account/lookup'),
    onSuccess: refresh,
  });

  const current = account.data?.account ?? null;
  return (
    <Card className="mb-4 max-w-3xl">
      <CardHeader>
        <CardTitle>{t('payoutAccount.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {account.isPending ? (
          <p className="text-muted-foreground">{t('common.loading')}</p>
        ) : current !== null && !editing ? (
          <>
            <p>
              {current.type === 'MOBILE_MONEY'
                ? t(`payoutAccount.operator.${current.operator ?? 'MPESA'}` as TranslationKey)
                : current.bankName}{' '}
              <span className="font-mono">{current.accountNumberMasked}</span>
            </p>
            {current.status === 'VERIFIED' && (
              <Badge tone="success">{t('payoutAccount.verified')}</Badge>
            )}
            {current.status === 'NAME_PENDING_CONFIRMATION' && current.lookupName !== null && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-2">
                <p>{t('payoutAccount.confirmPrompt', { name: current.lookupName })}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={confirm.isPending}
                    onClick={() => {
                      confirm.mutate(current.lookupName ?? '');
                    }}
                  >
                    {t('payoutAccount.confirmYes')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditing(true);
                    }}
                  >
                    {t('payoutAccount.confirmNo')}
                  </Button>
                </div>
              </div>
            )}
            {current.status === 'LOOKUP_FAILED' && (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">{t('payoutAccount.lookupFailed')}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  disabled={lookup.isPending}
                  onClick={() => {
                    lookup.mutate();
                  }}
                >
                  {t('payoutAccount.retryLookup')}
                </Button>
              </div>
            )}
            {!current.automaticPayout && (
              <p className="text-xs text-muted-foreground">{t('payoutAccount.manualNote')}</p>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => {
                setEditing(true);
              }}
            >
              {t('payoutAccount.change')}
            </Button>
          </>
        ) : (
          <>
            {current === null && <p className="text-muted-foreground">{t('payoutAccount.none')}</p>}
            <div className="flex flex-col gap-1">
              <Label htmlFor="payout-type">{t('payoutAccount.type')}</Label>
              <Select
                id="payout-type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as 'MOBILE_MONEY' | 'BANK');
                }}
              >
                <option value="MOBILE_MONEY">{t('payoutAccount.mobileMoney')}</option>
                <option value="BANK">{t('payoutAccount.bank')}</option>
              </Select>
            </div>
            {type === 'MOBILE_MONEY' ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor="payout-operator">{t('payoutAccount.operatorLabel')}</Label>
                <Select
                  id="payout-operator"
                  value={operator}
                  onChange={(event) => {
                    setOperator(event.target.value);
                  }}
                >
                  {OPERATORS.map((value) => (
                    <option key={value} value={value}>
                      {t(`payoutAccount.operator.${value}` as TranslationKey)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="payout-bank">{t('payoutAccount.bankName')}</Label>
                  <Input
                    id="payout-bank"
                    value={bankName}
                    onChange={(event) => {
                      setBankName(event.target.value);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="payout-holder">{t('payoutAccount.holderName')}</Label>
                  <Input
                    id="payout-holder"
                    value={accountName}
                    onChange={(event) => {
                      setAccountName(event.target.value);
                    }}
                  />
                </div>
              </>
            )}
            <div className="flex flex-col gap-1">
              <Label htmlFor="payout-number">
                {type === 'MOBILE_MONEY' ? t('payoutAccount.phone') : t('payoutAccount.accountNumber')}
              </Label>
              <Input
                id="payout-number"
                value={accountNumber}
                onChange={(event) => {
                  setAccountNumber(event.target.value);
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('payoutAccount.saveNote')}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={accountNumber.trim() === '' || save.isPending}
                onClick={() => {
                  save.mutate();
                }}
              >
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
              {current !== null && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(false);
                  }}
                >
                  {t('common.close')}
                </Button>
              )}
            </div>
            {save.isError && (
              <p className="text-destructive">
                {save.error instanceof ApiError ? save.error.message : t('common.error')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
