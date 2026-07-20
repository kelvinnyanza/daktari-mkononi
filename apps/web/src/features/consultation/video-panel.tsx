'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api } from '@/lib/api';

/**
 * Daily's **prebuilt** call UI in an iframe.
 *
 * Deliberately not a custom video UI: the prebuilt frame already handles
 * device pickers, permission prompts, network-quality warnings, screen share
 * and the long tail of browser quirks. Rebuilding that for a pilot would be
 * weeks of work to arrive somewhere worse. The mobile app uses the native
 * Daily SDK; the web portal uses the iframe.
 *
 * The meeting token is short-lived and role-scoped (doctor vs patient) and is
 * fetched only when the doctor actually joins — not on page load.
 */
export function VideoPanel({ consultationId }: { consultationId: string }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<{ destroy: () => void } | null>(null);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      frameRef.current?.destroy();
      frameRef.current = null;
    },
    [],
  );

  const join = async (): Promise<void> => {
    setError(null);
    try {
      const { meetingToken, roomUrl } = await api.get<{ meetingToken: string; roomUrl: string }>(
        `/api/v1/consultations/${consultationId}/token`,
      );
      const container = containerRef.current;
      if (container === null) return;

      // Imported lazily: daily-js pulls in a large bundle and touches browser
      // APIs, so it must not load during SSR or for consultations without video.
      const DailyIframe = (await import('@daily-co/daily-js')).default;
      const frame = DailyIframe.createFrame(container, {
        iframeStyle: { width: '100%', height: '100%', border: '0' },
        showLeaveButton: true,
      });
      frameRef.current = frame;
      await frame.join({ url: roomUrl, token: meetingToken });
      setJoined(true);
    } catch {
      setError(t('common.error'));
    }
  };

  const leave = (): void => {
    frameRef.current?.destroy();
    frameRef.current = null;
    setJoined(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {joined ? (
          <Button size="sm" variant="outline" onClick={leave}>
            {t('consultation.leaveVideo')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void join()}>
            {t('consultation.joinVideo')}
          </Button>
        )}
        {error !== null && <span className="text-xs text-destructive">{error}</span>}
      </div>
      <div
        ref={containerRef}
        className={joined ? 'h-[320px] w-full overflow-hidden rounded-md border border-border' : 'hidden'}
      />
    </div>
  );
}
