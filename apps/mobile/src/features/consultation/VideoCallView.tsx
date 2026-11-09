/**
 * Daily video surface. Loads the SDK lazily (dev build only); shows a
 * permission-denied state with a settings deep-link, and a "poor connection"
 * hint driven by Daily's network-quality events (2G reality — suggest AUDIO).
 * Never statically imports Daily, so jest/typecheck never touch native code.
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useT } from '../../i18n';
import { loadDaily, type DailyMediaViewProps, type LoadedDaily, type VideoCall } from '../../services/video/daily-boundary';
import { radius, space } from '../../theme/theme';
import { Button, EmptyState, LoadingState } from '../../ui';
import { participantTracks, startCallSession, type CallParticipant } from './call-session';
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
        <EmptyState icon="video-off" title={t('consult.call.permissionDenied')} />
        <Button icon="settings" label={t('consult.call.openSettings')} onPress={() => void Linking.openSettings()} />
      </View>
    );
  }
  if (error !== null && error !== 'load') {
    return (
      <View style={styles.stateBox}>
        <EmptyState
          icon="alert-circle"
          title={t('consult.call.joinFailed')}
          {...(error.detail !== null ? { message: error.detail } : {})}
        />
      </View>
    );
  }
  if (error === 'load') {
    return (
      <View style={styles.stateBox}>
        <EmptyState icon="video-off" title={t('consult.call.needDevBuild')} />
      </View>
    );
  }
  if (daily === null) {
    return (
      <View style={styles.stage}>
        <LoadingState label={t('consult.call.connecting')} onDark />
      </View>
    );
  }

  const MediaView = daily.MediaView;
  const remoteTracks = participantTracks(remote);
  const remoteProps: DailyMediaViewProps = {
    videoTrack: remoteTracks.video,
    audioTrack: remoteTracks.audio,
    objectFit: 'cover',
    style: styles.remote,
  };
  const localProps: DailyMediaViewProps = {
    videoTrack: participantTracks(local).video,
    mirror: true,
    objectFit: 'cover',
    style: styles.pip,
  };

  return (
    <View style={styles.stage}>
      {remote !== null ? (
        <MediaView {...remoteProps} />
      ) : (
        <LoadingState label={t('consult.call.connecting')} onDark />
      )}
      {videoEnabled && local !== null ? <MediaView {...localProps} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000000' },
  remote: { flex: 1 },
  pip: {
    position: 'absolute',
    top: space[4],
    right: space[4],
    width: 96,
    height: 128,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
  },
  stateBox: { flex: 1, justifyContent: 'center', gap: space[4], padding: space[6] },
});
