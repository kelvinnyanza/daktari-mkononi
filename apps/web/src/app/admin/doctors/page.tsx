'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { PaginatedTable, type Column } from '@/components/paginated-table';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { formatTzs } from '@/lib/eat';
import { verificationStatusTone } from '@/lib/status';

interface DoctorRow {
  doctorId: string;
  fullName: string;
  phone: string;
  specialty: string;
  tmcRegistrationNumber: string;
  verificationStatus: string;
  averageRating: number;
  totalConsultations: number;
  consultationFeeTzs: number;
  commissionOverridePercent: number | null;
}

const STATUSES = [
  'PENDING',
  'DOCUMENTS_SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;

export default function AdminDoctorsPage() {
  const t = useT();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const columns: Column<DoctorRow>[] = [
    {
      header: t('doctors.name'),
      cell: (row) => (
        <Link href={`/admin/verification/${row.doctorId}`} className="font-medium underline-offset-2 hover:underline">
          {row.fullName}
        </Link>
      ),
    },
    { header: t('verification.specialty'), cell: (row) => row.specialty },
    {
      header: t('verification.tmcNumber'),
      cell: (row) => <span className="font-mono text-xs">{row.tmcRegistrationNumber}</span>,
    },
    {
      header: t('doctors.status'),
      cell: (row) => (
        <Badge tone={verificationStatusTone(row.verificationStatus)}>{row.verificationStatus}</Badge>
      ),
    },
    {
      header: t('doctors.rating'),
      cell: (row) => (row.averageRating > 0 ? row.averageRating.toFixed(1) : '—'),
    },
    { header: t('doctors.consultations'), cell: (row) => row.totalConsultations },
    { header: t('doctors.fee'), cell: (row) => formatTzs(row.consultationFeeTzs) },
    {
      header: t('doctors.commission'),
      cell: (row) => <CommissionOverrideCell row={row} statusFilter={status} />,
    },
  ];

  return (
    <>
      <PageHeader title={t('doctors.title')} subtitle={t('doctors.subtitle')} />

      <div className="mb-4 flex flex-col gap-1">
        <Label htmlFor="doctor-status">{t('doctors.status')}</Label>
        <Select
          id="doctor-status"
          className="w-56"
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

      <PaginatedTable<DoctorRow>
        queryKey={['admin-doctors', status]}
        path={`/api/v1/doctors/admin/list${status === '' ? '' : `?status=${status}`}`}
        columns={columns}
        rowKey={(row) => row.doctorId}
        page={page}
        onPageChange={setPage}
      />
    </>
  );
}

/**
 * Per-doctor commission override (audited server-side, FEE_OVERRIDE_CHANGED).
 * Empty ⇒ the platform rate. Only new payments are affected — every payment
 * snapshots the rate it was created with.
 */
function CommissionOverrideCell({ row, statusFilter }: { row: DoctorRow; statusFilter: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(
    row.commissionOverridePercent === null ? '' : String(row.commissionOverridePercent),
  );
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: (commissionPercent: number | null) =>
      api.put(`/api/v1/admin/doctors/${row.doctorId}/commission`, { commissionPercent, note: note.trim() }),
    onSuccess: async () => {
      setEditing(false);
      setNote('');
      await queryClient.invalidateQueries({ queryKey: ['admin-doctors', statusFilter] });
    },
  });

  if (!editing) {
    return (
      <button
        type="button"
        className="text-left underline-offset-2 hover:underline"
        onClick={() => {
          setEditing(true);
        }}
      >
        {row.commissionOverridePercent === null
          ? t('fees.overrideDefault')
          : `${row.commissionOverridePercent}%`}
      </button>
    );
  }
  const value = Number(percent);
  const noteOk = note.trim().length >= 3;
  return (
    <div className="flex min-w-[220px] flex-col gap-1">
      <Input
        aria-label={t('fees.commissionPercent')}
        type="number"
        min={0}
        max={50}
        step={0.01}
        value={percent}
        onChange={(event) => {
          setPercent(event.target.value);
        }}
      />
      <Input
        aria-label={t('fees.note')}
        placeholder={t('fees.note')}
        value={note}
        onChange={(event) => {
          setNote(event.target.value);
        }}
      />
      <div className="flex gap-1">
        <Button
          size="sm"
          disabled={!noteOk || percent === '' || value < 0 || value > 50 || save.isPending}
          onClick={() => {
            save.mutate(value);
          }}
        >
          {t('fees.overrideSet')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!noteOk || save.isPending}
          onClick={() => {
            save.mutate(null);
          }}
        >
          {t('fees.overrideClear')}
        </Button>
      </div>
    </div>
  );
}
