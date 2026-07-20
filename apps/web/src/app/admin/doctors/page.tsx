'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PaginatedTable, type Column } from '@/components/paginated-table';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Label, Select } from '@/components/ui/input';
import { useT } from '@/i18n';
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
