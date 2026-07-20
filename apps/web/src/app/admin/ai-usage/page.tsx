'use client';

import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/portal-shell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n';
import { api } from '@/lib/api';

interface UsageSummary {
  sessions: { total: number; byStatus: Record<string, number> };
  tokensUsed: number;
  triageLevels: Record<string, number>;
  emergencyCount: number;
}

/** Order matters: most urgent first, so the bar reads top-down by severity. */
const TRIAGE_ORDER = ['EMERGENCY', 'URGENT', 'ROUTINE', 'SELF_CARE'] as const;

const TRIAGE_BAR: Record<string, string> = {
  EMERGENCY: 'bg-red-500',
  URGENT: 'bg-amber-500',
  ROUTINE: 'bg-sky-500',
  SELF_CARE: 'bg-emerald-500',
};

export default function AiUsagePage() {
  const t = useT();

  const usage = useQuery({
    queryKey: ['admin-ai-usage'],
    queryFn: () => api.get<UsageSummary>('/api/v1/admin/ai-usage'),
  });

  if (usage.isPending) {
    return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  }
  if (usage.isError) {
    return <p className="text-sm text-destructive">{t('common.error')}</p>;
  }

  const data = usage.data;
  const failed = data.sessions.byStatus['FAILED'] ?? 0;
  const failureRate = data.sessions.total === 0 ? 0 : (failed / data.sessions.total) * 100;

  // Triage counts only cover sessions that reached a triage decision.
  const triageTotal = Object.values(data.triageLevels).reduce((sum, count) => sum + count, 0);
  const levels = [
    ...TRIAGE_ORDER.filter((level) => level in data.triageLevels),
    ...Object.keys(data.triageLevels).filter(
      (level) => !TRIAGE_ORDER.includes(level as (typeof TRIAGE_ORDER)[number]),
    ),
  ];

  return (
    <>
      <PageHeader title={t('ai.title')} subtitle={t('ai.subtitle')} />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t('ai.totalRequests')} value={data.sessions.total.toLocaleString('en-US')} />
        <Metric label={t('ai.totalTokens')} value={data.tokensUsed.toLocaleString('en-US')} />
        <Metric label="Emergency escalations" value={data.emergencyCount.toLocaleString('en-US')} />
        <Metric label={t('ai.failureRate')} value={`${failureRate.toFixed(1)}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('ai.triageDistribution')}</CardTitle>
        </CardHeader>
        <CardContent>
          {triageTotal === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ai.noData')}</p>
          ) : (
            /* Plain divs, no charting dependency: a proportion bar is a width
               percentage, and a library would be 40 kB for one screen. */
            <div className="flex flex-col gap-3">
              {levels.map((level) => {
                const count = data.triageLevels[level] ?? 0;
                const percent = (count / triageTotal) * 100;
                return (
                  <div key={level} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">{level}</span>
                      <span className="text-muted-foreground">
                        {count.toLocaleString('en-US')} · {percent.toFixed(1)}%
                      </span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-muted"
                      role="img"
                      aria-label={`${level}: ${percent.toFixed(1)}%`}
                    >
                      <div
                        className={`h-full ${TRIAGE_BAR[level] ?? 'bg-muted-foreground'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Sessions by status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          {Object.entries(data.sessions.byStatus).map(([key, count]) => (
            <div key={key} className="flex flex-col">
              <span className="text-xs text-muted-foreground">{key}</span>
              <span className="font-medium">{count.toLocaleString('en-US')}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}
