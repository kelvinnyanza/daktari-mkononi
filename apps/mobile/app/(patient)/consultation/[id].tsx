/**
 * Consultation call screen: hosts VIDEO/AUDIO calls (Daily, lazy) and the
 * chat drawer / full-screen CHAT UI, all over one WS connection. Reacts to
 * consultation.status frames for the end states (completed → rating prompt;
 * abandoned → honest "interrupted" copy with the restart-once rule). Post-
 * completion links the generated medical record.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Body, Button, LoadingState } from '../../../src/components/ui';
import { chatReducer, initialChatState, type ChatEntry } from '../../../src/features/consultation/chat-reducer';
import { waitingRoomTransition } from '../../../src/features/consultation/waiting-room';
import { VideoCallView, type VideoCallHandle } from '../../../src/features/consultation/VideoCallView';
import { useT } from '../../../src/i18n';
import { API_BASE_URL } from '../../../src/services/config';
import { authApi, consultationApi } from '../../../src/services/endpoints';
import {
  ConsultationSocket,
  deriveWsBaseUrl,
  type MinimalSocket,
  type SocketState,
} from '../../../src/services/ws';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

const MAX_CHAT_LEN = 2000;

type Phase = 'connecting' | 'in-call' | 'completed' | 'interrupted';

export default function ConsultationScreen(): React.JSX.Element {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const consultationId = id ?? '';

  const queryClient = useQueryClient();
  const consultation = useQuery({
    queryKey: ['consultation', consultationId],
    queryFn: () => consultationApi.get(consultationId),
    // Backstop for the WS consultation.status frame: if the socket is down
    // when the doctor completes, the call screen still ends within ~10s.
    refetchInterval: (q) => (q.state.data?.status === 'IN_PROGRESS' ? 10_000 : false),
  });
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => authApi.me() });
  const token = useQuery({
    queryKey: ['consultation', consultationId, 'token'],
    queryFn: () => consultationApi.meetingToken(consultationId),
    enabled:
      consultation.data?.status === 'IN_PROGRESS' &&
      consultation.data.videoRoomUrl !== null,
    retry: false,
    // The token keys the call session: a background refetch mid-call would
    // swap it and rejoin. Fixed for this screen's life; dropped on unmount so
    // a rejoin always fetches a fresh (unexpired) one.
    staleTime: Infinity,
    gcTime: 0,
  });

  const [chat, dispatchChat] = useReducer(chatReducer, initialChatState);
  const [socketState, setSocketState] = useState<SocketState>('closed');
  const [phase, setPhase] = useState<Phase>('connecting');
  const [interruptedUsedUp, setInterruptedUsedUp] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [poorConnection, setPoorConnection] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const controlsRef = useRef<VideoCallHandle | null>(null);
  const socketRef = useRef<ConsultationSocket | null>(null);

  const selfUserId = me.data?.user.id ?? '';
  const onControls = useCallback((handle: VideoCallHandle) => {
    controlsRef.current = handle;
  }, []);

  // Load chat history once we know who we are.
  useEffect(() => {
    if (selfUserId === '') return;
    let cancelled = false;
    void consultationApi.messages(consultationId).then((history) => {
      if (!cancelled) {
        dispatchChat({ type: 'HISTORY_LOADED', selfUserId, messages: history.items });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [consultationId, selfUserId]);

  // WS connection: chat + consultation.status. Fresh single-use ticket per attempt.
  useEffect(() => {
    if (selfUserId === '') return;
    const socket = new ConsultationSocket({
      consultationId,
      wsBaseUrl: deriveWsBaseUrl(API_BASE_URL),
      fetchTicket: async () => (await consultationApi.wsTicket()).ticket,
      // RN's WebSocket exposes the same onopen/onmessage/onerror/onclose/send/
      // close surface as MinimalSocket.
      socketFactory: (url) => new WebSocket(url) as unknown as MinimalSocket,
      onEvent: (frame) => {
        if (frame.type === 'chat.message') {
          dispatchChat({
            type: 'INBOUND_MESSAGE',
            messageId: frame.messageId,
            senderUserId: frame.senderUserId,
            body: frame.body,
            sentAt: frame.sentAt,
            selfUserId,
          });
        } else if (frame.type === 'consultation.status') {
          const next = waitingRoomTransition(frame);
          if (next === 'completed') setPhase('completed');
          else if (next === 'interrupted') setPhase('interrupted');
        }
      },
      onStateChange: setSocketState,
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      socketRef.current = null;
    };
  }, [consultationId, selfUserId]);

  // Derive phase from the loaded consultation status.
  useEffect(() => {
    if (consultation.data === undefined) return;
    if (consultation.data.status === 'IN_PROGRESS') setPhase('in-call');
    else if (consultation.data.status === 'COMPLETED') setPhase('completed');
    else if (consultation.data.status === 'ABANDONED') {
      setPhase('interrupted');
      setInterruptedUsedUp((consultation.data.endReason ?? '').startsWith('TECHNICAL_FAILURE'));
    }
  }, [consultation.data]);

  // The call ended (completed / interrupted): every screen showing this
  // appointment is now stale. Without this, "Back" landed on a cached
  // IN_PROGRESS Appointment details (Join button, no rating section).
  const appointmentId = consultation.data?.appointmentId;
  useEffect(() => {
    if ((phase !== 'completed' && phase !== 'interrupted') || appointmentId === undefined) return;
    void queryClient.invalidateQueries({ queryKey: ['appointments'] });
    void queryClient.invalidateQueries({ queryKey: ['consultation-status', appointmentId] });
    void queryClient.invalidateQueries({ queryKey: ['rating', appointmentId] });
  }, [phase, appointmentId, queryClient]);

  const sendChat = useCallback(
    (body: string): void => {
      const trimmed = body.slice(0, MAX_CHAT_LEN).trim();
      if (trimmed.length === 0) return;
      const key = `tmp-${Date.now()}`;
      dispatchChat({
        type: 'OPTIMISTIC_SEND',
        key,
        body: trimmed,
        selfUserId,
        sentAt: new Date().toISOString(),
      });
      const ok = socketRef.current?.sendChat(trimmed) ?? false;
      if (!ok) dispatchChat({ type: 'SEND_FAILED', key });
    },
    [selfUserId],
  );

  const isChatType = consultation.data?.appointmentId !== undefined && phase === 'in-call';

  if (consultation.isPending || me.isPending) return <LoadingState />;

  if (phase === 'completed') {
    return <EndedState consultationId={consultationId} appointmentId={consultation.data?.appointmentId} interrupted={false} usedUp={false} />;
  }
  if (phase === 'interrupted') {
    return <EndedState consultationId={consultationId} appointmentId={consultation.data?.appointmentId} interrupted usedUp={interruptedUsedUp} />;
  }

  const isVideo = consultation.data?.videoRoomUrl !== null;
  const fullScreenChat = !isVideo; // CHAT/AUDIO → chat-forward; VIDEO → drawer

  return (
    <View style={styles.container}>
      {isVideo && token.data !== undefined ? (
        <VideoCallView
          roomUrl={token.data.roomUrl}
          token={token.data.meetingToken}
          videoEnabled={!cameraOff}
          onQuality={setPoorConnection}
          onControls={onControls}
        />
      ) : fullScreenChat ? (
        <ChatPanel entries={chat.entries} onSend={sendChat} onRetry={sendChat} fullScreen />
      ) : (
        <LoadingState />
      )}

      {poorConnection ? (
        <View style={styles.poor} accessibilityRole="alert">
          <Text style={styles.poorText}>{t('consult.call.poorConnection')}</Text>
        </View>
      ) : null}

      {isVideo ? (
        <View style={styles.controls}>
          <ControlButton
            label={muted ? t('consult.call.unmute') : t('consult.call.mute')}
            onPress={() => {
              const next = !muted;
              setMuted(next);
              controlsRef.current?.toggleAudio(!next);
            }}
          />
          <ControlButton
            label={cameraOff ? t('consult.call.cameraOn') : t('consult.call.cameraOff')}
            onPress={() => setCameraOff((v) => !v)}
          />
          <ControlButton label={t('consult.call.flip')} onPress={() => controlsRef.current?.flip()} />
          <ControlButton label={t('consult.call.chat')} onPress={() => setShowChat(true)} />
          <ControlButton label={t('consult.call.end')} destructive onPress={() => router.back()} />
        </View>
      ) : null}

      {isVideo && showChat ? (
        <View style={styles.drawer}>
          <ChatPanel entries={chat.entries} onSend={sendChat} onRetry={sendChat} fullScreen={false} />
          <Button label={t('common.back')} onPress={() => setShowChat(false)} />
        </View>
      ) : null}

      {socketState === 'failed' ? (
        <View style={styles.poor}>
          <Text style={styles.poorText}>{t('consult.waiting.status.failed')}</Text>
        </View>
      ) : null}
      {isChatType ? null : null}
    </View>
  );
}

function ControlButton({
  label,
  onPress,
  destructive,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.control, destructive === true && styles.controlDanger]}
    >
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

function ChatPanel({
  entries,
  onSend,
  onRetry,
  fullScreen,
}: {
  entries: ChatEntry[];
  onSend: (body: string) => void;
  onRetry: (body: string) => void;
  fullScreen: boolean;
}): React.JSX.Element {
  const t = useT();
  const [draft, setDraft] = useState('');
  const listData = useMemo(() => [...entries], [entries]);

  return (
    <View style={[styles.chat, fullScreen && styles.chatFull]}>
      <FlatList
        data={listData}
        keyExtractor={(entry) => entry.key}
        renderItem={({ item }) => (
          <Pressable
            disabled={item.status !== 'failed'}
            onPress={() => item.status === 'failed' && onRetry(item.body)}
            style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}
          >
            <Text style={item.mine ? styles.bubbleMineText : styles.bubbleText}>{item.body}</Text>
            {item.status === 'pending' ? <Text style={styles.meta}>{t('consult.chat.pending')}</Text> : null}
            {item.status === 'failed' ? <Text style={styles.metaFail}>{t('consult.chat.failed')}</Text> : null}
          </Pressable>
        )}
        contentContainerStyle={styles.chatContent}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={(text) => setDraft(text.slice(0, MAX_CHAT_LEN))}
          placeholder={t('consult.chat.placeholder')}
          placeholderTextColor={colors.textMuted}
          multiline
          accessibilityLabel={t('consult.chat.placeholder')}
        />
        <Button
          label={t('consult.chat.send')}
          onPress={() => {
            onSend(draft);
            setDraft('');
          }}
          disabled={draft.trim().length === 0}
        />
      </View>
    </View>
  );
}

function EndedState({
  consultationId,
  appointmentId,
  interrupted,
  usedUp,
}: {
  consultationId: string;
  appointmentId: string | undefined;
  interrupted: boolean;
  usedUp: boolean;
}): React.JSX.Element {
  const t = useT();
  // Is a medical record linked yet? (generated on completion)
  const record = useQuery({
    queryKey: ['record-for-consultation', consultationId],
    queryFn: () => consultationApi.get(consultationId),
    enabled: !interrupted,
  });
  void record; // status already known; record linkage surfaced via records tab

  return (
    <View style={styles.endedBox}>
      <Text style={styles.endedTitle}>
        {interrupted ? t('consult.ended.interrupted') : t('consult.ended.completed')}
      </Text>
      {interrupted ? (
        <Body>
          {usedUp
            ? t('consult.ended.interrupted.usedUp')
            : t('consult.ended.interrupted.canRestart')}
        </Body>
      ) : null}

      {!interrupted && appointmentId !== undefined ? (
        <Button
          label={t('consult.ended.viewRecord')}
          onPress={() => router.replace('/(patient)/records')}
        />
      ) : null}

      {interrupted && usedUp ? (
        <Button label={t('consult.ended.support')} onPress={() => router.replace('/(patient)/home')} />
      ) : null}

      <Button
        label={t('common.back')}
        onPress={() =>
          appointmentId !== undefined
            ? router.replace({ pathname: '/(patient)/appointments/[id]', params: { id: appointmentId } })
            : router.back()
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.md,
    backgroundColor: '#000000',
  },
  control: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    minWidth: 60,
    alignItems: 'center',
  },
  controlDanger: { backgroundColor: colors.danger },
  controlLabel: { ...typography.caption, color: colors.text },
  poor: { backgroundColor: colors.danger, padding: spacing.sm, alignItems: 'center' },
  poorText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '60%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    padding: spacing.sm,
  },
  chat: { flex: 1 },
  chatFull: { backgroundColor: colors.background },
  chatContent: { padding: spacing.md, gap: spacing.sm },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  bubbleText: { ...typography.body, color: colors.text },
  bubbleMineText: { ...typography.body, color: colors.onPrimary },
  meta: { ...typography.caption, color: colors.onPrimary, opacity: 0.8 },
  metaFail: { ...typography.caption, color: '#FFE0E0', fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    maxHeight: 100,
    ...typography.body,
    color: colors.text,
  },
  endedBox: { flex: 1, justifyContent: 'center', padding: spacing.lg, gap: spacing.md },
  endedTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
});
