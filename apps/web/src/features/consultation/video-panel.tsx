'use client';

import { useEffect, useRef, useState } from 'react';
import type { DailyCall } from '@daily-co/daily-js';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { api } from '@/lib/api';
import { dailyErrorDetail } from './daily-error';
import { joinWithCameraFallback } from './join-with-fallback';

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
 *
 * A camera that cannot start never blocks the doctor: the join falls back to
 * audio only (see join-with-fallback.ts) and a camera picker can turn video
 * back on. Every destroy() is awaited before the next frame is created, so a
 * Leave → Join never asks for the camera while the old frame still holds it.
 */
export function VideoPanel({ consultationId }: { consultationId: string }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<DailyCall | null>(null);
  const releasingRef = useRef<Promise<void>>(Promise.resolve());
  const attemptRef = useRef(0);
  // 'joining' must already show the frame: Daily Prebuilt's pre-join screen
  // (domain enable_prejoin_ui) opens the camera and waits for a click on its
  // own Join button, so join() cannot resolve while the frame is hidden — the
  // doctor sat on a 0×0 iframe holding the camera and never entered the room.
  const [phase, setPhase] = useState<'idle' | 'joining' | 'joined'>('idle');
  const joined = phase === 'joined';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraOff, setCameraOff] = useState(false);
  const [cameras, setCameras] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [cameraId, setCameraId] = useState('');

  /** Destroy the current frame; the next join waits for this to finish. */
  const release = (): Promise<void> => {
    const frame = frameRef.current;
    frameRef.current = null;
    if (frame !== null) {
      releasingRef.current = releasingRef.current.then(() => frame.destroy()).catch(() => undefined);
    }
    return releasingRef.current;
  };

  // Unmount only: release the frame (and with it the camera).
  useEffect(
    () => () => {
      void release();
    },
    [],
  );

  const loadCameras = async (frame: DailyCall): Promise<void> => {
    try {
      const { devices } = await frame.enumerateDevices();
      const inputs = devices
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Camera ${String(index + 1)}` }));
      setCameras(inputs);
      setCameraId((current) => current || (inputs[0]?.deviceId ?? ''));
    } catch {
      setCameras([]);
    }
  };

  const join = async (): Promise<void> => {
    // Leave during the pre-join screen bumps the attempt: the abandoned join
    // must neither flip the panel to 'joined' nor report its teardown as an error.
    const attempt = ++attemptRef.current;
    setError(null);
    setCameraOff(false);
    setBusy(true);
    try {
      await releasingRef.current; // a previous frame must let go of the camera first
      const { meetingToken, roomUrl } = await api.get<{ meetingToken: string; roomUrl: string }>(
        `/api/v1/consultations/${consultationId}/token`,
      );
      const container = containerRef.current;
      if (container === null) return;

      // Imported lazily: daily-js pulls in a large bundle and touches browser
      // APIs, so it must not load during SSR or for consultations without video.
      const DailyIframe = (await import('@daily-co/daily-js')).default;
      setPhase('joining'); // frame visible from creation (pre-join screen)
      const result = await joinWithCameraFallback(
        () => {
          const frame = DailyIframe.createFrame(container, {
            iframeStyle: { width: '100%', height: '100%', border: '0' },
            showLeaveButton: true,
          });
          frameRef.current = frame;
          return frame;
        },
        { url: roomUrl, token: meetingToken },
        () => setCameraOff(true),
      );
      if (attempt !== attemptRef.current) return; // left while joining
      frameRef.current = result.frame as DailyCall;
      setCameraOff(result.cameraOff);
      setPhase('joined');
      void loadCameras(result.frame as DailyCall);
    } catch (caught) {
      if (attempt !== attemptRef.current) return; // teardown of an abandoned join
      // A failed join leaves the call object alive; without destroying it the
      // next click throws "Duplicate DailyIframe instances are not allowed".
      setPhase('idle');
      await release();
      const detail = dailyErrorDetail(caught);
      setError(detail === null ? t('common.error') : `${t('common.error')} (${detail})`);
    } finally {
      setBusy(false);
    }
  };

  const turnCameraOn = async (): Promise<void> => {
    const frame = frameRef.current;
    if (frame === null || cameraId === '') return;
    setBusy(true);
    try {
      await frame.setInputDevicesAsync({ videoDeviceId: cameraId });
      frame.setLocalVideo(true);
      setCameraOff(false); // a renewed camera-error flips this back on
    } catch {
      setCameraOff(true);
    } finally {
      setBusy(false);
    }
  };

  const leave = async (): Promise<void> => {
    attemptRef.current += 1;
    setPhase('idle');
    setCameraOff(false);
    setBusy(true);
    await release();
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {phase !== 'idle' ? (
          // Also offered while joining: a pre-join screen the doctor abandons
          // must still release the camera.
          <Button size="sm" variant="outline" onClick={() => void leave()} disabled={joined && busy}>
            {t('consultation.leaveVideo')}
          </Button>
        ) : (
          <Button size="sm" onClick={() => void join()} disabled={busy}>
            {t('consultation.joinVideo')}
          </Button>
        )}
        {error !== null && <span className="text-xs text-destructive">{error}</span>}
      </div>
      {phase === 'joining' && (
        <p className="text-xs text-muted-foreground">{t('consultation.preJoinHint')}</p>
      )}
      {joined && cameraOff && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2 text-xs">
          <span>{t('consultation.cameraUnavailable')}</span>
          {cameras.length > 0 && (
            <>
              <select
                aria-label={t('consultation.pickCamera')}
                className="rounded border border-border bg-background px-1 py-0.5"
                value={cameraId}
                onChange={(event) => setCameraId(event.target.value)}
              >
                {cameras.map((camera) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => void turnCameraOn()} disabled={busy}>
                {t('consultation.cameraOn')}
              </Button>
            </>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="video-frame-container"
        className={
          phase === 'idle' ? 'hidden' : 'h-[420px] w-full overflow-hidden rounded-md border border-border'
        }
      />
    </div>
  );
}
