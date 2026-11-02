'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';

type VatMode = 'ON_TOP_OF_COMMISSION' | 'INCLUDED_IN_COMMISSION';

interface FeeSettingsView {
  id: string | null;
  commissionPercent: number;
  vatEnabled: boolean;
  vatPercent: number;
  vatMode: VatMode;
  minPayoutTzs: number;
  effectiveFrom: string | null;
  note: string | null;
  createdAt: string | null;
}

interface Preview {
  feeTzs: number;
  platformCommissionTzs: number;
  vatTzs: number;
  doctorAmountTzs: number;
}

const PREVIEW_FEES = [15_000, 20_000, 50_000] as const;

/**
 * Platform commission / VAT / minimum payout. Saving adds a NEW
 * effective-dated row (the server refuses back-dating and audits the change);
 * existing payments keep the rates they were created with. The worked
 * examples come from the server's own calculator for the CURRENT rates, so
 * the screen can never show a rounding rule the server does not apply.
 */
export default function AdminFeesPage() {
  const t = useT();
  const queryClient = useQueryClient();

  const overview = useQuery({
    queryKey: ['admin-fee-settings'],
    queryFn: () =>
      api.get<{ current: FeeSettingsView; history: FeeSettingsView[] }>('/api/v1/admin/settings/fees'),
  });

  const previews = useQuery({
    queryKey: ['admin-fee-preview', overview.data?.current.id ?? 'defaults'],
    enabled: overview.data !== undefined,
    queryFn: () =>
      Promise.all(
        PREVIEW_FEES.map((fee) => api.get<Preview>(`/api/v1/admin/settings/fees/preview?feeTzs=${fee}`)),
      ),
  });

  const [commission, setCommission] = useState('');
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatPercent, setVatPercent] = useState('');
  const [vatMode, setVatMode] = useState<VatMode>('ON_TOP_OF_COMMISSION');
  const [minPayout, setMinPayout] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [note, setNote] = useState('');

  const current = overview.data?.current;
  useEffect(() => {
    if (current === undefined) return;
    setCommission(String(current.commissionPercent));
    setVatEnabled(current.vatEnabled);
    setVatPercent(String(current.vatPercent));
    setVatMode(current.vatMode);
    setMinPayout(String(current.minPayoutTzs));
  }, [current]);

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/v1/admin/settings/fees', {
        commissionPercent: Number(commission),
        vatEnabled,
        vatPercent: Number(vatPercent),
        vatMode,
        minPayoutTzs: Number(minPayout),
        // datetime-local is EAT wall-clock; the API stores UTC.
        ...(effectiveFrom !== '' ? { effectiveFrom: new Date(`${effectiveFrom}:00+03:00`).toISOString() } : {}),
        note: note.trim(),
      }),
    onSuccess: async () => {
      setNote('');
      setEffectiveFrom('');
      await queryClient.invalidateQueries({ queryKey: ['admin-fee-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-fee-preview'] });
    },
  });

  const commissionValue = Number(commission);
  const valid =
    commission !== '' &&
    commissionValue >= 0 &&
    commissionValue <= 50 &&
    Number(vatPercent) >= 0 &&
    Number(vatPercent) <= 30 &&
    Number.isInteger(Number(minPayout)) &&
    Number(minPayout) >= 1_000 &&
    note.trim().length >= 3;

  return (
    <>
      <PageHeader title={t('fees.title')} subtitle={t('fees.subtitle')} />

      {overview.isPending ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : overview.isError ? (
        <p className="text-sm text-destructive">{t('common.error')}</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>{t('fees.current')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Line label={t('fees.commission')} value={`${overview.data.current.commissionPercent}%`} />
              <Line
                label={t('fees.vat')}
                value={
                  overview.data.current.vatEnabled
                    ? `${overview.data.current.vatPercent}% — ${t(
                        overview.data.current.vatMode === 'ON_TOP_OF_COMMISSION'
                          ? 'fees.vatMode.ON_TOP_OF_COMMISSION'
                          : 'fees.vatMode.INCLUDED_IN_COMMISSION',
                      )}`
                    : t('fees.vatOff')
                }
              />
              <Line label={t('fees.minPayout')} value={formatTzs(overview.data.current.minPayoutTzs)} />
              {overview.data.current.id === null && (
                <p className="text-xs text-muted-foreground">{t('fees.defaultsInUse')}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{t('fees.vatExemptNote')}</p>

              <h3 className="mt-3 text-xs font-semibold uppercase text-muted-foreground">
                {t('fees.workedExamples')}
              </h3>
              {previews.data === undefined ? (
                <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('fees.fee')}</TH>
                      <TH>{t('fees.commission')}</TH>
                      <TH>{t('fees.vat')}</TH>
                      <TH>{t('fees.doctorReceives')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {previews.data.map((row) => (
                      <TR key={row.feeTzs}>
                        <TD className="tabular-nums">{formatTzs(row.feeTzs)}</TD>
                        <TD className="tabular-nums">{formatTzs(row.platformCommissionTzs)}</TD>
                        <TD className="tabular-nums">{formatTzs(row.vatTzs)}</TD>
                        <TD className="font-medium tabular-nums">{formatTzs(row.doctorAmountTzs)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              <p className="text-xs text-muted-foreground">{t('fees.roundingRule')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('fees.change')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Field id="commission" label={t('fees.commissionPercent')}>
                <Input
                  id="commission"
                  type="number"
                  min={0}
                  max={50}
                  step={0.01}
                  value={commission}
                  onChange={(event) => {
                    setCommission(event.target.value);
                  }}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={vatEnabled}
                  onChange={(event) => {
                    setVatEnabled(event.target.checked);
                  }}
                />
                {t('fees.vatEnabled')}
              </label>
              <Field id="vat" label={t('fees.vatPercent')}>
                <Input
                  id="vat"
                  type="number"
                  min={0}
                  max={30}
                  step={0.01}
                  disabled={!vatEnabled}
                  value={vatPercent}
                  onChange={(event) => {
                    setVatPercent(event.target.value);
                  }}
                />
              </Field>
              <Field id="vat-mode" label={t('fees.vatModeLabel')}>
                <Select
                  id="vat-mode"
                  disabled={!vatEnabled}
                  value={vatMode}
                  onChange={(event) => {
                    setVatMode(event.target.value as VatMode);
                  }}
                >
                  <option value="ON_TOP_OF_COMMISSION">{t('fees.vatMode.ON_TOP_OF_COMMISSION')}</option>
                  <option value="INCLUDED_IN_COMMISSION">{t('fees.vatMode.INCLUDED_IN_COMMISSION')}</option>
                </Select>
              </Field>
              <Field id="min-payout" label={t('fees.minPayout')}>
                <Input
                  id="min-payout"
                  type="number"
                  min={1000}
                  step={1}
                  value={minPayout}
                  onChange={(event) => {
                    setMinPayout(event.target.value);
                  }}
                />
              </Field>
              <Field id="effective" label={t('fees.effectiveFrom')}>
                <Input
                  id="effective"
                  type="datetime-local"
                  value={effectiveFrom}
                  onChange={(event) => {
                    setEffectiveFrom(event.target.value);
                  }}
                />
              </Field>
              <Field id="fee-note" label={t('fees.note')}>
                <Textarea
                  id="fee-note"
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                  }}
                />
              </Field>
              <p className="text-xs text-muted-foreground">{t('fees.historyNote')}</p>
              <Button
                disabled={!valid || save.isPending}
                onClick={() => {
                  save.mutate();
                }}
              >
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
              {save.isError && (
                <p className="text-sm text-destructive">
                  {save.error instanceof ApiError ? save.error.message : t('common.error')}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>{t('fees.history')}</CardTitle>
            </CardHeader>
            {overview.data.history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t('fees.historyEmpty')}</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('fees.effectiveFrom')}</TH>
                    <TH>{t('fees.commission')}</TH>
                    <TH>{t('fees.vat')}</TH>
                    <TH>{t('fees.minPayout')}</TH>
                    <TH>{t('fees.note')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {overview.data.history.map((row) => (
                    <TR key={row.id ?? 'defaults'}>
                      <TD className="text-muted-foreground">
                        {row.effectiveFrom !== null ? eatDateTimeLabel(row.effectiveFrom) : '—'}
                        {row.id === overview.data.current.id && (
                          <Badge tone="success" className="ml-2">
                            {t('fees.inForce')}
                          </Badge>
                        )}
                      </TD>
                      <TD className="tabular-nums">{row.commissionPercent}%</TD>
                      <TD>
                        {row.vatEnabled
                          ? `${row.vatPercent}% (${row.vatMode === 'ON_TOP_OF_COMMISSION' ? '+' : '⊂'})`
                          : t('fees.vatOff')}
                      </TD>
                      <TD className="tabular-nums">{formatTzs(row.minPayoutTzs)}</TD>
                      <TD className="text-xs">{row.note ?? ''}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
