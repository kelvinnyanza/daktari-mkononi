'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { eatTimeLabel } from '@/lib/eat';
import { cn } from '@/lib/utils';
import { useConsultationSocket } from './use-consultation-socket';

interface HistoryResponse {
  items: Array<{ id: string; senderUserId: string; body: string; sentAt: string }>;
}

export function ChatPanel({
  consultationId,
  selfUserId,
}: {
  consultationId: string;
  selfUserId: string;
}) {
  const t = useT();
  const { state, send, loadHistory } = useConsultationSocket(consultationId, selfUserId);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  const history = useQuery({
    queryKey: ['consultation-messages', consultationId],
    queryFn: () =>
      api.get<HistoryResponse>(`/api/v1/consultations/${consultationId}/messages?pageSize=100`),
  });

  useEffect(() => {
    if (history.data !== undefined) loadHistory(history.data.items);
  }, [history.data, loadHistory]);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [state.entries.length]);

  const submit = (): void => {
    const body = draft.trim();
    if (body === '') return;
    send(body);
    setDraft('');
  };

  return (
    <Card className="flex flex-1 flex-col">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('consultation.chat')}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {state.connection === 'connected'
            ? state.peers.length > 0
              ? t('consultation.patientOnline')
              : t('consultation.patientOffline')
            : state.connection === 'connecting'
              ? t('consultation.reconnecting')
              : t('consultation.disconnected')}
        </span>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2">
        <div ref={listRef} className="flex h-72 flex-col gap-2 overflow-y-auto">
          {state.entries.map((entry) => (
            <div
              key={entry.key}
              className={cn(
                'max-w-[85%] rounded-md px-2 py-1 text-sm',
                entry.mine ? 'self-end bg-primary/10' : 'self-start bg-muted',
                entry.status === 'failed' && 'border border-destructive',
              )}
            >
              <p>{entry.body}</p>
              <span className="text-[10px] text-muted-foreground">
                {eatTimeLabel(entry.sentAt)}
                {entry.status === 'pending' && ' · …'}
                {entry.status === 'failed' && ' · !'}
              </span>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Input
            aria-label={t('consultation.chat')}
            placeholder={t('consultation.chatPlaceholder')}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
          <Button size="sm" disabled={draft.trim() === ''} onClick={submit}>
            {t('consultation.send')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
