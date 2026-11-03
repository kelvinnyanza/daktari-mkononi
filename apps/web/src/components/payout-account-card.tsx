'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { useT, type TranslationKey } from '@/i18n';
import { ApiError, api } from '@/lib/api';

export interface PayoutAccount {
  type: 'MOBILE_MONEY' | 'BANK';
  operator: string | null;
  bankName: string | null;
  accountNumberMasked: string;
  lookupName: string | null;
  status: 'NAME_PENDING_CONFIRMATION' | 'LOOKUP_FAILED' | 'VERIFIED';
  automaticPayout: boolean;
}

const OPERATORS = ['MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'HALOPESA', 'AZAMPESA'] as const;

/**
 * Where payouts are sent. Saving looks the holder up with AzamPay; the
 * doctor must confirm the returned name before the account is used. Any
 * change re-verifies (server-enforced, audited).
 */
export function PayoutAccountCard() {
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
