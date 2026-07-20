'use client';

import { useState } from 'react';
import { PaginatedTable, type Column } from '@/components/paginated-table';
import { PageHeader } from '@/components/portal-shell';
import { Input, Label } from '@/components/ui/input';
import { useT } from '@/i18n';

interface PatientRow {
  id: string;
  patientNumber: string;
  fullName: string;
  region: string;
  district: string;
}

/**
 * Directory only. `GET /api/v1/patients` is `patient:read:any` + `phi-read`
 * audited on the server — every visit to this page writes an AuditLog row, so
 * it deliberately shows identity and location, never clinical data.
 */
export default function AdminPatientsPage() {
  const t = useT();
  const [region, setRegion] = useState('');
  const [district, setDistrict] = useState('');
  const [page, setPage] = useState(1);

  const filters = new URLSearchParams();
  if (region !== '') filters.set('region', region);
  if (district !== '') filters.set('district', district);
  const query = filters.toString();

  const columns: Column<PatientRow>[] = [
    { header: t('patients.name'), cell: (row) => <span className="font-medium">{row.fullName}</span> },
    {
      header: 'Patient number',
      cell: (row) => <span className="font-mono text-xs">{row.patientNumber}</span>,
    },
    { header: t('patients.region'), cell: (row) => row.region },
    { header: t('patients.district'), cell: (row) => row.district },
  ];

  return (
    <>
      <PageHeader title={t('patients.title')} subtitle={t('patients.subtitle')} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="region">{t('patients.region')}</Label>
          <Input
            id="region"
            className="w-48"
            value={region}
            onChange={(event) => {
              setRegion(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="district">{t('patients.district')}</Label>
          <Input
            id="district"
            className="w-48"
            value={district}
            onChange={(event) => {
              setDistrict(event.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      <PaginatedTable<PatientRow>
        queryKey={['admin-patients', region, district]}
        path={`/api/v1/patients${query === '' ? '' : `?${query}`}`}
        columns={columns}
        rowKey={(row) => row.id}
        page={page}
        onPageChange={setPage}
      />
    </>
  );
}
