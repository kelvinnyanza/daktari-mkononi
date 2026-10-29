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
import { startCallSession, type CallParticipant } from './call-session';
import type { JoinFailure } from './video-error';

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
  const [error, setError] = useState<'load' | JoinFailure | null>(null);
  const [local, setLocal] = useState<CallParticipant | null>(null);
  const [remote, setRemote] = useState<CallParticipant | null>(null);
  const callRef = useRef<VideoCall | null>(null);
  // Latest callbacks, read by the session on each event: their identity must
  // never restart the call (an inline callback used to rejoin on every render).
  const propsRef = useRef({ onQuality, onControls });
  propsRef.current = { onQuality, onControls };

  // Exactly one call per (roomUrl, token) — see call-session.ts.
  useEffect(() => {
    setError(null);
    setRemote(null);
    setLocal(null);
    const session = startCallSession({
      load: loadDaily,
      roomUrl,
      token,
      listeners: () => ({
        onLoaded: (loaded, call) => {
          setDaily(loaded);
          callRef.current = call;
          propsRef.current.onControls({
            toggleAudio: (enabled) => call.setLocalAudio(enabled),
            toggleVideo: (enabled) => call.setLocalVideo(enabled),
            flip: () => void call.cycleCamera(),
          });
        },
        onLoadFailed: () => setError('load'),
        onLocal: setLocal,
        onRemote: setRemote,
        onQuality: (poor) => propsRef.current.onQuality(poor),
        onFailure: setError,
      }),
    });
    return () => {
      session.stop(); // leave → destroy, awaited before any next call starts
      callRef.current = null;
    };
  }, [roomUrl, token]);

  useEffect(() => {
    callRef.current?.setLocalVideo(videoEnabled);
  }, [videoEnabled]);

  if (error !== null && error !== 'load' && error.kind === 'permission') {
    return (
      <View style={styles.stateBox}>
        <Body>{t('consult.call.permissionDenied')}</Body>
        <Button label={t('consult.call.openSettings')} onPress={() => void Linking.openSettings()} />
      </View>
    );
  }
  if (error !== null && error !== 'load') {
    return (
      <View style={styles.stateBox}>
        <Body>
          {error.detail === null
            ? t('consult.call.joinFailed')
            : `${t('consult.call.joinFailed')} (${error.detail})`}
        </Body>
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
