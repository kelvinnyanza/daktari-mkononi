'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT, type TranslationKey } from '@/i18n';
import { api } from '@/lib/api';
import { eatDateTimeLabel, formatTzs } from '@/lib/eat';
import { paymentStatusTone } from '@/lib/status';

interface PaymentRow {
  id: string;
  appointmentId: string | null;
  amountTzs: number;
  platformFeeTzs: number;
  vatTzs: number;
  doctorAmountTzs: number;
  commissionBps: number | null;
  vatBps: number | null;
  vatMode: string | null;
  providerFeeTzs: number | null;
  method: string;
  status: string;
  attempt: number;
  failureReason: string | null;
  refundPending: boolean;
  refundState: string | null;
  receivedAmountTzs: number | null;
  reviewReason: string | null;
  reviewNote: string | null;
  reviewFlaggedAt: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
}

const STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED'] as const;

export default function AdminPaymentsPage() {
  const t = useT();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<PaymentRow | null>(null);
  const [chaseNote, setChaseNote] = useState('');
  const [chaseDone, setChaseDone] = useState<string | null>(null);

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (status !== '') query.set('status', status);
  if (from !== '') query.set('from', from);
  if (to !== '') query.set('to', to);

  const payments = useQuery({
    queryKey: ['admin-payments', status, from, to, page],
    queryFn: () =>
      api.get<{ items: PaymentRow[]; total: number; page: number; pageSize: number }>(
        `/api/v1/admin/payments?${query.toString()}`,
      ),
  });

  const refunds = useQuery({
    queryKey: ['admin-refunds-pending'],
    queryFn: () => api.get<{ items: PaymentRow[] }>('/api/v1/admin/refunds/pending'),
  });

  const chase = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/api/v1/admin/refunds/${id}/chase`, { note }),
    onSuccess: async (_result, variables) => {
      setChaseNote('');
      setChaseDone(variables.id);
      await queryClient.invalidateQueries({ queryKey: ['admin-refunds-pending'] });
    },
  });

  const pages =
    payments.data !== undefined ? Math.max(1, Math.ceil(payments.data.total / payments.data.pageSize)) : 1;

  return (
    <>
      <PageHeader title={t('payments.title')} subtitle={t('payments.subtitle')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">{t('payments.status')}</Label>
          <Select
            id="status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="from">{t('payments.from')}</Label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="to">{t('payments.to')}</Label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          {payments.isPending ? (
            <p className="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : payments.isError ? (
            <p className="p-4 text-sm text-destructive">{t('common.error')}</p>
          ) : payments.data.items.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('payments.created')}</TH>
                    <TH>{t('payments.amount')}</TH>
                    <TH>{t('payments.method')}</TH>
                    <TH>{t('payments.status')}</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {payments.data.items.map((payment) => (
                    <TR key={payment.id}>
                      <TD className="text-muted-foreground">{eatDateTimeLabel(payment.createdAt)}</TD>
                      <TD className="font-medium">{formatTzs(payment.amountTzs)}</TD>
                      <TD>{payment.method}</TD>
                      <TD>
                        <Badge tone={paymentStatusTone(payment.status)}>{payment.status}</Badge>
                        {payment.refundPending && (
                          <Badge tone="warning" className="ml-2">
                            {t('payments.refundsPending')}
                          </Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDetail(payment);
                          }}
                        >
                          {t('verification.open')}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              <div className="flex items-center justify-between border-t border-border p-3 text-xs">
                <span className="text-muted-foreground">
                  {t('common.page', { page: payments.data.page, pages })}
                </span>
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
            </>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <ReviewQueueCard />

          {detail !== null && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{formatTzs(detail.amountTzs)}</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDetail(null);
                  }}
                >
                  {t('common.close')}
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {/* The split is shown verbatim from the server — the invariant
                    platformFee + doctorAmount === amount is property-tested
                    there, so any drift here is visible at a glance. */}
                <Row label={t('payments.platformFee')} value={formatTzs(detail.platformFeeTzs)} />
                <Row label={t('payments.vat')} value={formatTzs(detail.vatTzs)} />
                <Row label={t('payments.doctorAmount')} value={formatTzs(detail.doctorAmountTzs)} />
                {detail.commissionBps !== null && (
                  <Row
                    label={t('payments.rates')}
                    value={`${detail.commissionBps / 100}% · VAT ${(detail.vatBps ?? 0) / 100}% ${
                      detail.vatMode === 'INCLUDED_IN_COMMISSION' ? '(incl.)' : '(+)'
                    }`}
                  />
                )}
                {detail.providerFeeTzs !== null && (
                  <Row label={t('payments.providerFee')} value={formatTzs(detail.providerFeeTzs)} />
                )}
                <Row label={t('payments.status')} value={detail.status} />
                <Row label={t('payments.method')} value={detail.method} />
                <Row label="Attempt" value={String(detail.attempt)} />
                <Row label={t('payments.created')} value={eatDateTimeLabel(detail.createdAt)} />
                {detail.paidAt !== null && (
                  <Row label="Paid" value={eatDateTimeLabel(detail.paidAt)} />
                )}
                {detail.refundedAt !== null && (
                  <Row label="Refunded" value={eatDateTimeLabel(detail.refundedAt)} />
                )}
                {detail.failureReason !== null && (
                  <Row label="Failure" value={detail.failureReason} />
                )}
                {detail.appointmentId !== null && (
                  <Row label="Appointment" value={detail.appointmentId} />
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('payments.refundsPending')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {refunds.isPending ? (
                <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
              ) : refunds.isError ? (
                <p className="text-sm text-destructive">{t('common.error')}</p>
              ) : refunds.data.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('payments.refundsPendingEmpty')}</p>
              ) : (
                refunds.data.items.map((payment) => (
                  <div key={payment.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{formatTzs(payment.amountTzs)}</span>
                      <span className="text-xs text-muted-foreground">
                        {eatDateTimeLabel(payment.createdAt)}
                      </span>
                    </div>
                    <Textarea
                      aria-label={t('payments.chaseNote')}
                      placeholder={t('payments.chaseNote')}
                      value={chaseNote}
                      onChange={(event) => {
                        setChaseNote(event.target.value);
                      }}
                      className="min-h-[60px]"
                    />
                    <p className="text-xs text-muted-foreground">{t('payments.chaseNoteHint')}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={chaseNote.trim().length < 3 || chase.isPending}
                      onClick={() => {
                        chase.mutate({ id: payment.id, note: chaseNote.trim() });
                      }}
                    >
                      {t('payments.markChased')}
                    </Button>
                    {chaseDone === payment.id && (
                      <p className="text-xs text-muted-foreground">{t('payments.chaseRecorded')}</p>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * Admin alert queue: payments the server refused to treat as normal (late
 * success → auto-refund, amount mismatch → never confirmed, stuck after
 * abandonment, stray attempt). Resolving only records what the admin did.
 */
function ReviewQueueCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const review = useQuery({
    queryKey: ['admin-payments-review'],
    queryFn: () => api.get<{ items: PaymentRow[] }>('/api/v1/admin/payments/review'),
  });

  const resolve = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/api/v1/admin/payments/${id}/review/resolve`, { note }),
    onSuccess: async (_result, variables) => {
      setNotes((current) => ({ ...current, [variables.id]: '' }));
      await queryClient.invalidateQueries({ queryKey: ['admin-payments-review'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('payments.review.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {review.isPending ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : review.isError ? (
          <p className="text-sm text-destructive">{t('common.error')}</p>
        ) : review.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('payments.review.empty')}</p>
        ) : (
          review.data.items.map((payment) => {
            const note = notes[payment.id] ?? '';
            return (
              <div key={payment.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{formatTzs(payment.amountTzs)}</span>
                  <Badge tone="warning">{payment.status}</Badge>
                </div>
                <p className="text-xs">
                  {t(`payments.review.reason.${payment.reviewReason ?? ''}` as TranslationKey)}
                </p>
                {payment.receivedAmountTzs !== null &&
                  payment.receivedAmountTzs !== payment.amountTzs && (
                    <Row
                      label={t('payments.review.received')}
                      value={formatTzs(payment.receivedAmountTzs)}
                    />
                  )}
                {payment.refundState !== null && (
                  <Row label={t('payments.refundState')} value={payment.refundState} />
                )}
                {payment.reviewFlaggedAt !== null && (
                  <span className="text-xs text-muted-foreground">
                    {eatDateTimeLabel(payment.reviewFlaggedAt)}
                  </span>
                )}
                <Textarea
                  aria-label={t('payments.review.note')}
                  placeholder={t('payments.review.note')}
                  value={note}
                  onChange={(event) => {
                    setNotes((current) => ({ ...current, [payment.id]: event.target.value }));
                  }}
                  className="min-h-[60px]"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={note.trim().length < 3 || resolve.isPending}
                  onClick={() => {
                    resolve.mutate({ id: payment.id, note: note.trim() });
                  }}
                >
                  {t('payments.review.resolve')}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  );
}
