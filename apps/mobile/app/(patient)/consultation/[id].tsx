/**
 * Consultation call screen: hosts VIDEO/AUDIO calls (Daily, lazy) and the
 * chat drawer / full-screen CHAT UI, all over one WS connection. Reacts to
 * consultation.status frames for the end states (completed → rating prompt;
 * abandoned → honest "interrupted" copy with the restart-once rule). Post-
 * completion links the generated medical record.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlatList, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { chatReducer, initialChatState, type ChatEntry } from '../../../src/features/consultation/chat-reducer';
import { waitingRoomTransition } from '../../../src/features/consultation/waiting-room';
import { VideoCallView, type VideoCallHandle } from '../../../src/features/consultation/VideoCallView';
import { useCallKeepAwake } from '../../../src/features/consultation/use-call-keep-awake';
import { postCallStep } from '../../../src/features/rating/post-call';
import { RatingSection } from '../../../src/features/rating/RatingSection';
import { useT } from '../../../src/i18n';
import { API_BASE_URL } from '../../../src/services/config';
import { authApi, consultationApi, ratingApi } from '../../../src/services/endpoints';
import {
  ConsultationSocket,
  deriveWsBaseUrl,
  type MinimalSocket,
  type SocketState,
} from '../../../src/services/ws';
import { createStyles, layout, radius, space, type, useTheme } from '../../../src/theme/theme';
import {
  Banner,
  Button,
  EmptyState,
  Icon,
  IconButton,
  LoadingState,
  Text,
  type IconName,
} from '../../../src/ui';
import { noWebOutline } from '../../../src/ui/web-outline';

const MAX_CHAT_LEN = 2000;

type Phase = 'connecting' | 'in-call' | 'completed' | 'interrupted';

export default function ConsultationScreen(): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
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

  // Screen stays awake only during the live call (focused + foreground);
  // released when the call ends or the screen is left.
  useCallKeepAwake(phase === 'in-call');

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
        <View style={styles.stage}>
          <LoadingState label={t('consult.call.connecting')} onDark />
        </View>
      )}

      {poorConnection || socketState === 'failed' ? (
        <View style={styles.alerts}>
          {poorConnection ? <Banner tone="warning" icon="wifi" message={t('consult.call.poorConnection')} /> : null}
          {socketState === 'failed' ? <Banner tone="danger" icon="wifi-off" message={t('consult.waiting.status.failed')} /> : null}
        </View>
      ) : null}

      {isVideo ? (
        <View style={styles.controls}>
          <ControlButton
            icon={muted ? 'mic-off' : 'mic'}
            active={muted}
            label={muted ? t('consult.call.unmute') : t('consult.call.mute')}
            onPress={() => {
              const next = !muted;
              setMuted(next);
              controlsRef.current?.toggleAudio(!next);
            }}
          />
          <ControlButton
            icon={cameraOff ? 'video-off' : 'video'}
            active={cameraOff}
            label={cameraOff ? t('consult.call.cameraOn') : t('consult.call.cameraOff')}
            onPress={() => setCameraOff((v) => !v)}
          />
          <ControlButton icon="refresh-cw" label={t('consult.call.flip')} onPress={() => controlsRef.current?.flip()} />
          <ControlButton icon="message-square" label={t('consult.call.chat')} onPress={() => setShowChat(true)} />
          <ControlButton icon="phone-off" label={t('consult.call.end')} destructive onPress={() => router.back()} />
        </View>
      ) : null}

      {isVideo && showChat ? (
        <View style={styles.drawer}>
          <View style={styles.drawerHead}>
            <Text variant="heading" accessibilityRole="header" style={styles.drawerTitle}>
              {t('consult.chat.title')}
            </Text>
            <IconButton icon="x" accessibilityLabel={t('a11y.close')} onPress={() => setShowChat(false)} />
          </View>
          <ChatPanel entries={chat.entries} onSend={sendChat} onRetry={sendChat} fullScreen={false} />
        </View>
      ) : null}
      {isChatType ? null : null}
    </View>
  );
}

/** Round 56dp icon control with its label underneath (icons alone are not enough for everyone). */
function ControlButton({
  icon,
  label,
  onPress,
  destructive = false,
  active = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  /** Toggled-off state (muted / camera off) — inverted colours. */
  active?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.control}
    >
      {({ pressed }) => (
        <>
          <View
            style={[
              styles.controlCircle,
              active && styles.controlCircleActive,
              destructive && styles.controlCircleDanger,
              pressed && styles.controlCirclePressed,
            ]}
          >
            <Icon name={icon} color={destructive ? colors.dangerFg : active ? colors.text : colors.textOnPrimary} />
          </View>
          <Text variant="caption" tone="onPrimary" align="center" style={styles.controlLabel}>
            {label}
          </Text>
        </>
      )}
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
  const styles = useStyles();
  const { colors } = useTheme();
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
            accessibilityRole={item.status === 'failed' ? 'button' : undefined}
            onPress={() => item.status === 'failed' && onRetry(item.body)}
            style={[
              styles.bubble,
              item.mine ? styles.bubbleMine : styles.bubbleTheirs,
              item.status === 'failed' && styles.bubbleFailed,
            ]}
          >
            <Text tone={item.mine && item.status !== 'failed' ? 'onPrimary' : 'default'}>{item.body}</Text>
            {item.status === 'pending' ? (
              <Text variant="caption" tone="onPrimary" style={styles.meta}>
                {t('consult.chat.pending')}
              </Text>
            ) : null}
            {item.status === 'failed' ? (
              <View style={styles.failRow}>
                <Icon name="alert-circle" size={14} color={colors.dangerFg} />
                <Text variant="caption" tone="danger" style={styles.failText}>
                  {t('consult.chat.failed')}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )}
        contentContainerStyle={styles.chatContent}
        keyboardShouldPersistTaps="handled"
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={(text) => setDraft(text.slice(0, MAX_CHAT_LEN))}
          placeholder={t('consult.chat.placeholder')}
          placeholderTextColor={colors.textSecondary}
          multiline
          accessibilityLabel={t('consult.chat.placeholder')}
        />
        <Button
          label={t('consult.chat.send')}
          icon="send"
          size="sm"
          fullWidth={false}
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
  const styles = useStyles();
  const back = (): void =>
    appointmentId !== undefined
      ? router.replace({ pathname: '/(patient)/appointments/[id]', params: { id: appointmentId } })
      : router.back();

  if (interrupted) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.endedScroll}>
        <EmptyState
          icon="alert-triangle"
          title={t('consult.ended.interrupted')}
          message={usedUp ? t('consult.ended.interrupted.usedUp') : t('consult.ended.interrupted.canRestart')}
        />
        {usedUp ? (
          <Button icon="help-circle" label={t('consult.ended.support')} onPress={() => router.replace('/(patient)/home')} />
        ) : null}
        <Button variant={usedUp ? 'ghost' : 'primary'} icon="arrow-left" label={t('common.back')} onPress={back} />
      </ScrollView>
    );
  }
  return <CompletedFlow consultationId={consultationId} appointmentId={appointmentId} onBack={back} />;
}

/**
 * Completed → optional rating (with Ruka / Skip) → medical record. Rating can
 * never block the record: see postCallStep. A skipped rating stays on
 * Appointment details.
 */
function CompletedFlow({
  appointmentId,
  onBack,
}: {
  consultationId: string;
  appointmentId: string | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const [skipped, setSkipped] = useState(false);
  const [rated, setRated] = useState(false);
  const status = useQuery({
    queryKey: ['rating', appointmentId],
    queryFn: () => ratingApi.statusForAppointment(appointmentId ?? ''),
    enabled: appointmentId !== undefined,
    retry: false,
  });
  const step = postCallStep({
    appointmentId,
    skipped,
    rated,
    status: { isError: status.isError, data: status.data },
  });

  if (step === 'rate' && appointmentId !== undefined) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.endedScroll}>
        <EmptyState icon="check-circle" title={t('consult.ended.completed')} />
        <RatingSection appointmentId={appointmentId} onDone={() => setRated(true)} />
        <Button variant="ghost" label={t('rating.skip')} onPress={() => setSkipped(true)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.endedScroll}>
      <EmptyState
        icon="check-circle"
        title={t('consult.ended.completed')}
        {...(rated ? { message: t('rating.thanks') } : skipped ? { message: t('rating.later') } : {})}
      />
      <Button icon="file-text" label={t('consult.ended.viewRecord')} onPress={() => router.replace('/(patient)/records')} />
      <Button variant="ghost" icon="arrow-left" label={t('common.back')} onPress={onBack} />
    </ScrollView>
  );
}

const useStyles = createStyles((c) => ({
  container: { flex: 1, backgroundColor: c.background },
  stage: { flex: 1, backgroundColor: '#000000' },
  alerts: { position: 'absolute', top: space[3], left: space[3], right: space[3], gap: space[2] },
  // Call controls sit on dark ink (the video stage is black): white icons/labels.
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    backgroundColor: c.text,
  },
  control: { alignItems: 'center', gap: space[1], flex: 1, minHeight: layout.touchTarget },
  controlCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  controlCircleActive: { backgroundColor: c.surface },
  // White with a red icon: solid red is reserved for 112/115.
  controlCircleDanger: { backgroundColor: c.surface },
  controlCirclePressed: { opacity: 0.75 },
  controlLabel: { maxWidth: 88 },
  drawer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '65%',
    backgroundColor: c.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space[2],
  },
  drawerHead: { flexDirection: 'row', alignItems: 'center', paddingLeft: space[4], paddingRight: space[2] },
  drawerTitle: { flex: 1 },
  chat: { flex: 1 },
  chatFull: { backgroundColor: c.background },
  chatContent: { padding: space[4], gap: space[3], width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: 2,
  },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: c.primary, borderTopRightRadius: radius.sm },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderTopLeftRadius: radius.sm,
  },
  bubbleFailed: { backgroundColor: c.dangerBg, borderWidth: 1, borderColor: c.dangerBorder },
  meta: { opacity: 0.85 },
  failRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  failText: { flexShrink: 1 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    minHeight: layout.touchTarget,
    maxHeight: 120,
    ...type.body,
    color: c.text,
    backgroundColor: c.surface,
    ...noWebOutline,
  },
  endedScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: space[6],
    gap: space[4],
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
}));
