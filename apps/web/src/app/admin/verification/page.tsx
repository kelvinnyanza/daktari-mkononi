'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { PageHeader } from '@/components/portal-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { eatDateTimeLabel } from '@/lib/eat';
import { useAuthStore } from '@/stores/auth';
import { verificationStatusTone } from '@/lib/status';

interface QueueItem {
  doctorId: string;
  fullName: string;
  specialty: string;
  verificationStatus: string;
  claimedByUserId: string | null;
  updatedAt: string;
}

interface QueueResponse {
  items: QueueItem[];
  page: number;
  pageSize: number;
  total: number;
}

export default function VerificationQueuePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const adminUserId = useAuthStore((state) => state.user?.id ?? '');

  const queue = useQuery({
    queryKey: ['verification-queue'],
    queryFn: () => api.get<QueueResponse>('/api/v1/doctors/admin/verification-queue?pageSize=50'),
  });

  const claim = useMutation({
    mutationFn: (doctorId: string) => api.post(`/api/v1/doctors/admin/${doctorId}/claim`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['verification-queue'] }),
  });

  return (
    <>
      <PageHeader title={t('verification.title')} subtitle={t('verification.subtitle')} />

      <Card>
        {queue.isPending ? (
          <p className="p-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : queue.isError ? (
          <p className="p-4 text-sm text-destructive">{t('common.error')}</p>
        ) : queue.data.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t('verification.empty')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('doctors.name')}</TH>
                <TH>{t('verification.specialty')}</TH>
                <TH>{t('doctors.status')}</TH>
                <TH>{t('verification.submitted')}</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {queue.data.items.map((item) => {
                const mine = item.claimedByUserId === adminUserId;
                const claimedByOther = item.claimedByUserId !== null && !mine;
                return (
                  <TR key={item.doctorId}>
                    <TD className="font-medium">{item.fullName}</TD>
                    <TD>{item.specialty}</TD>
                    <TD>
                      <Badge tone={verificationStatusTone(item.verificationStatus)}>
                        {item.verificationStatus}
                      </Badge>
                      {mine && (
                        <Badge tone="info" className="ml-2">
                          {t('verification.claimed')}
                        </Badge>
                      )}
                      {claimedByOther && (
                        <Badge tone="warning" className="ml-2">
                          {t('verification.claimedBy')}
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-muted-foreground">{eatDateTimeLabel(item.updatedAt)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        {item.claimedByUserId === null && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={claim.isPending}
                            onClick={() => {
                              claim.mutate(item.doctorId);
                            }}
                          >
                            {t('verification.claim')}
                          </Button>
                        )}
                        <Link href={`/admin/verification/${item.doctorId}`}>
                          <Button size="sm">{t('verification.open')}</Button>
                        </Link>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
