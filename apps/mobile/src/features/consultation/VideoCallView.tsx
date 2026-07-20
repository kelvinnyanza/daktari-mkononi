/**
 * Daily video surface. Loads the SDK lazily (dev build only); shows a
 * permission-denied state with a settings deep-link, and a "poor connection"
 * hint driven by Daily's network-quality events (2G reality — suggest AUDIO).
 * Never statically imports Daily, so jest/typecheck never touch native code.
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Body, Button, LoadingState } from '../../components/ui';
import { useT } from '../../i18n';
import { loadDaily, type DailyMediaViewProps, type LoadedDaily, type VideoCall } from '../../services/video/daily-boundary';
import { radius, spacing, typography } from '../../theme/tokens';

interface Participant {
  videoTrack?: unknown;
  audioTrack?: unknown;
}

export interface VideoCallHandle {
  toggleAudio: (enabled: boolean) => void;
  toggleVideo: (enabled: boolean) => void;
  flip: () => void;
}

export function VideoCallView({
  roomUrl,
  token,
  videoEnabled,
  onQuality,
  onControls,
}: {
  roomUrl: string;
  token: string;
  videoEnabled: boolean;
  onQuality: (poor: boolean) => void;
  onControls: (handle: VideoCallHandle) => void;
}): React.JSX.Element {
  const t = useT();
  const [daily, setDaily] = useState<LoadedDaily | null>(null);
  const [error, setError] = useState<'load' | 'permission' | null>(null);
  const [local, setLocal] = useState<Participant | null>(null);
  const [remote, setRemote] = useState<Participant | null>(null);
  const callRef = useRef<VideoCall | null>(null);

  useEffect(() => {
    let disposed = false;
    let call: VideoCall | null = null;

    void (async () => {
      let loaded: LoadedDaily;
      try {
        loaded = await loadDaily();
      } catch {
        if (!disposed) setError('load');
        return;
      }
      if (disposed) return;
      setDaily(loaded);
      call = loaded.createCall();
      callRef.current = call;
      onControls({
        toggleAudio: (enabled) => call?.setLocalAudio(enabled),
        toggleVideo: (enabled) => call?.setLocalVideo(enabled),
        flip: () => void call?.cycleCamera(),
      });

      call.on('participant-updated', (payload) => {
        const p = payload as { participant?: { local?: boolean; tracks?: unknown } };
        if (p.participant?.local === true) setLocal(p.participant as Participant);
        else if (p.participant !== undefined) setRemote(p.participant as Participant);
      });
      call.on('network-quality-change', (payload) => {
        const q = payload as { threshold?: string };
        onQuality(q.threshold === 'low' || q.threshold === 'very-low');
      });
      call.on('error', (payload) => {
        const e = payload as { errorMsg?: string };
        if (e.errorMsg !== undefined && /permission|denied|camera|microphone/i.test(e.errorMsg)) {
          setError('permission');
        }
      });

      try {
        await call.join({ url: roomUrl, token });
      } catch {
        if (!disposed) setError('permission');
      }
    })();

    return () => {
      disposed = true;
      void call?.leave().then(() => call?.destroy());
      callRef.current = null;
    };
    // Join once per room/token; control toggles happen imperatively. onControls
    // and onQuality are stable callbacks from the parent.
  }, [roomUrl, token, onControls, onQuality]);

  useEffect(() => {
    callRef.current?.setLocalVideo(videoEnabled);
  }, [videoEnabled]);

  if (error === 'permission') {
    return (
      <View style={styles.stateBox}>
        <Body>{t('consult.call.permissionDenied')}</Body>
        <Button label={t('consult.call.openSettings')} onPress={() => void Linking.openSettings()} />
      </View>
    );
  }
  if (error === 'load') {
    return (
      <View style={styles.stateBox}>
        <Body>{t('consult.call.needDevBuild')}</Body>
      </View>
    );
  }
  if (daily === null) return <LoadingState />;

  const MediaView = daily.MediaView;
  const remoteProps: DailyMediaViewProps = {
    videoTrack: remote?.videoTrack,
    audioTrack: remote?.audioTrack,
    objectFit: 'cover',
    style: styles.remote,
  };
  const localProps: DailyMediaViewProps = {
    videoTrack: local?.videoTrack,
    mirror: true,
    objectFit: 'cover',
    style: styles.pip,
  };

  return (
    <View style={styles.stage}>
      {remote !== null ? <MediaView {...remoteProps} /> : <Text style={styles.waiting}>{t('consult.call.connecting')}</Text>}
      {videoEnabled && local !== null ? <MediaView {...localProps} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000000' },
  remote: { flex: 1 },
  pip: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    width: 96,
    height: 128,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  waiting: { ...typography.body, color: '#FFFFFF', textAlign: 'center', marginTop: spacing.xl },
  stateBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
});
