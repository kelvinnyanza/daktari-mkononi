/**
 * Screening chat (Phase 9). The SERVER drives all triage logic; this screen
 * renders responses and reacts to status. EMERGENCY takes over the whole
 * screen with tap-to-call 112/115; 429s render the server's bilingual
 * message VERBATIM (it carries the emergency guidance).
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import {
  initialScreeningState,
  screeningReducer,
  type SuggestedDoctor,
} from '../../src/features/screening/reducer';
import {
  clearSessionId,
  loadSessionId,
  saveSessionId,
} from '../../src/features/screening/session-store';
import { useT } from '../../src/i18n';
import { errorMessage, isApiError } from '../../src/lib/errors';
import { specialtyLabel } from '../../src/lib/labels';
import { formatTzs } from '../../src/lib/money';
import { screeningApi } from '../../src/services/endpoints';
import { fontFamily } from '../../src/theme/fonts';
import { createStyles, layout, radius, space, type, useTheme } from '../../src/theme/theme';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Header,
  Icon,
  Skeleton,
  SkeletonGroup,
  Text,
} from '../../src/ui';

const MAX_LEN = 500;

export default function ScreeningScreen(): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const { colors } = useTheme();
  const [state, dispatch] = useReducer(screeningReducer, initialScreeningState);
  const [draft, setDraft] = useState('');
  const [resuming, setResuming] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Resume an ACTIVE session on mount (transcript comes decrypted from the server).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const saved = await loadSessionId();
      if (saved !== null) {
        try {
          const session = await screeningApi.getSession(saved);
          if (!cancelled && session.status === 'ACTIVE') {
            dispatch({ type: 'RESUMED', sessionId: saved, messages: session.transcript });
          } else if (!cancelled) {
            await clearSessionId();
          }
        } catch {
          if (!cancelled) await clearSessionId();
        }
      }
      if (!cancelled) setResuming(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const start = async (): Promise<void> => {
    dispatch({ type: 'START_REQUESTED' });
    try {
      const started = await screeningApi.start();
      await saveSessionId(started.sessionId);
      dispatch({ type: 'STARTED', sessionId: started.sessionId, opening: started.message });
    } catch (error) {
      dispatch({ type: 'FAIL', message: errorMessage(error, t('common.error.generic')) });
    }
  };

  const send = async (): Promise<void> => {
    const message = draft.trim();
    if (message.length === 0 || state.phase !== 'active' || state.sessionId === null) return;
    setDraft('');
    dispatch({ type: 'SEND', message });
    try {
      const reply = await screeningApi.sendMessage(state.sessionId, message);
      dispatch({
        type: 'REPLY',
        reply: reply.reply,
        status: reply.status,
        triage: reply.triage,
        suggestedDoctors: reply.suggestedDoctors,
      });
      if (reply.status === 'COMPLETED') await clearSessionId();
    } catch (error) {
      if (isApiError(error) && error.code === 'SESSION_NOT_ACTIVE') {
        await clearSessionId();
        dispatch({ type: 'SESSION_EXPIRED' });
        return;
      }
      // 429 and everything else: the server's bilingual message, VERBATIM.
      dispatch({ type: 'FAIL', message: errorMessage(error, t('common.error.generic')) });
    }
  };

  const startFresh = async (): Promise<void> => {
    await clearSessionId();
    dispatch({ type: 'RESET' });
    await start();
  };

  // ── Full-screen emergency layout: red, huge tap-to-call, nothing else. ────
  // Always the solid emergency colour; scrolls so large system fonts never clip.
  if (state.phase === 'emergency') {
    const lastMessage = state.messages.at(-1)?.content ?? '';
    return (
      <ScrollView style={styles.emergencyScreen} contentContainerStyle={styles.emergencyContent}>
        <View accessibilityRole="alert" style={styles.emergencyInner}>
          <Icon name="alert-triangle" size={56} color={colors.onEmergency} />
          <Text style={styles.emergencyTitle} accessibilityRole="header">
            {t('screening.emergency.title')}
          </Text>
          <Text tone="onEmergency" align="center">
            {lastMessage}
          </Text>
          <Text variant="title" tone="onEmergency" align="center">
            {t('screening.emergency.instruction')}
          </Text>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.emergencyCall, pressed && styles.emergencyCallPressed]}
            onPress={() => void Linking.openURL('tel:112')}
          >
            <Icon name="phone" size={28} color={colors.emergencyBg} />
            <Text style={styles.emergencyCallLabel}>{t('screening.emergency.call112')}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.emergencyCall, pressed && styles.emergencyCallPressed]}
            onPress={() => void Linking.openURL('tel:115')}
          >
            <Icon name="phone" size={28} color={colors.emergencyBg} />
            <Text style={styles.emergencyCallLabel}>{t('screening.emergency.call115')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const header = (
    <Header
      title={t('screening.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(patient)/home'))}
    />
  );

  if (resuming) {
    return (
      <View style={styles.container}>
        {header}
        <View style={[styles.column, styles.padded]}>
          <SkeletonGroup>
            <Skeleton width="70%" height={56} rounded={radius.lg} />
            <View style={styles.skeletonUser}>
              <Skeleton height={44} rounded={radius.lg} />
            </View>
            <Skeleton width="80%" height={72} rounded={radius.lg} />
          </SkeletonGroup>
        </View>
      </View>
    );
  }

  if (state.phase === 'idle' || state.phase === 'starting') {
    return (
      <View style={styles.container}>
        {header}
        <ScrollView contentContainerStyle={[styles.column, styles.padded]}>
          {state.error !== null ? (
            <ErrorState message={state.error} onRetry={() => void start()} />
          ) : (
            <>
              <EmptyState icon="message-circle" title={t('screening.title')} message={t('screening.intro')} />
              <Button
                label={t('screening.start')}
                icon="play"
                onPress={() => void start()}
                loading={state.phase === 'starting'}
              />
            </>
          )}
        </ScrollView>
      </View>
    );
  }

  if (state.phase === 'expired') {
    return (
      <View style={styles.container}>
        {header}
        <ScrollView contentContainerStyle={[styles.column, styles.padded]}>
          <EmptyState
            icon="clock"
            title={t('screening.expired')}
            action={{ label: t('screening.newSession'), icon: 'refresh-cw', onPress: () => void startFresh() }}
          />
        </ScrollView>
      </View>
    );
  }

  const completed = state.phase === 'completed';
  const triage = state.triage;
  return (
    <View style={styles.container}>
      {header}
      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        contentContainerStyle={[styles.column, styles.chatContent]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {state.messages.map((message, index) => (
          <View
            key={index}
            style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
          >
            <Text tone={message.role === 'user' ? 'onPrimary' : 'default'}>{message.content}</Text>
          </View>
        ))}
        {state.phase === 'sending' ? (
          <View style={[styles.bubble, styles.bubbleAssistant]} accessibilityLiveRegion="polite">
            <Text tone="secondary" style={styles.typing}>
              {t('screening.typing')}
            </Text>
          </View>
        ) : null}
        {state.error !== null ? <Banner tone="danger" message={state.error} /> : null}

        {completed && triage !== null && triage.triageLevel !== 'EMERGENCY' ? (
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('screening.triage.title')}
            </Text>
            <Badge
              tone={triage.triageLevel === 'SELF_CARE' ? 'success' : 'info'}
              icon={
                triage.triageLevel === 'SELF_CARE' ? 'home' : triage.triageLevel === 'IN_PERSON_VISIT' ? 'map-pin' : 'video'
              }
              label={
                triage.triageLevel === 'SELF_CARE'
                  ? t('screening.triage.SELF_CARE')
                  : triage.triageLevel === 'IN_PERSON_VISIT'
                    ? t('screening.triage.IN_PERSON_VISIT')
                    : t('screening.triage.TELECONSULTATION')
              }
            />
            {state.suggestedDoctors.length > 0 ? (
              <View style={styles.doctorList}>
                <Text variant="bodyStrong">{t('screening.doctors.title')}</Text>
                {state.suggestedDoctors.map((doctor) => (
                  <SuggestedDoctorRow key={doctor.id} doctor={doctor} sessionId={state.sessionId} />
                ))}
              </View>
            ) : null}
            <Button
              variant="secondary"
              icon="refresh-cw"
              label={t('screening.newSession')}
              onPress={() => void startFresh()}
            />
          </Card>
        ) : null}
      </ScrollView>

      {!completed ? (
        <View style={styles.inputBar}>
          <View style={[styles.column, styles.inputRow]}>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.input}
                value={draft}
                onChangeText={(text) => setDraft(text.slice(0, MAX_LEN))}
                placeholder={t('screening.inputPlaceholder')}
                placeholderTextColor={colors.textSecondary}
                editable={state.phase === 'active'}
                multiline
                accessibilityLabel={t('screening.inputPlaceholder')}
              />
              <Text variant="caption" tone="secondary" style={styles.counter}>
                {`${draft.length}/${MAX_LEN}`}
              </Text>
            </View>
            <Button
              label={t('screening.send')}
              icon="send"
              size="sm"
              fullWidth={false}
              onPress={() => void send()}
              loading={state.phase === 'sending'}
              disabled={state.phase !== 'active' || draft.trim().length === 0}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SuggestedDoctorRow({
  doctor,
  sessionId,
}: {
  doctor: SuggestedDoctor;
  sessionId: string | null;
}): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  return (
    <View style={styles.doctorRow}>
      <View style={styles.doctorHead}>
        <Avatar name={doctor.fullName} />
        <View style={styles.doctorText}>
          <Text variant="bodyStrong">{doctor.fullName}</Text>
          <Text variant="caption" tone="secondary">
            {`${specialtyLabel(t, doctor.specialty)} · ${formatTzs(doctor.consultationFeeTzs)}`}
          </Text>
          <Badge tone="neutral" icon="star" label={doctor.averageRating.toFixed(1)} />
        </View>
      </View>
      <Button
        size="sm"
        icon="calendar"
        label={t('screening.doctors.book')}
        onPress={() =>
          router.push({
            pathname: '/(patient)/doctors/[id]',
            params: { id: doctor.id, ...(sessionId !== null ? { screeningResultId: sessionId } : {}) },
          })
        }
      />
    </View>
  );
}

const useStyles = createStyles((c) => ({
  container: { flex: 1, backgroundColor: c.background },
  column: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center' },
  padded: { padding: space[4], gap: space[4] },
  skeletonUser: { alignSelf: 'flex-end', width: '55%' },
  chat: { flex: 1 },
  chatContent: { padding: space[4], gap: space[3] },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.lg,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  bubbleAssistant: {
    alignSelf: 'flex-start',
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderTopLeftRadius: radius.sm,
  },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: c.primary, borderTopRightRadius: radius.sm },
  typing: { fontStyle: 'italic' },
  inputBar: { backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  inputBox: { flex: 1, gap: 2 },
  input: {
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    minHeight: layout.touchTarget,
    maxHeight: 140,
    ...type.body,
    color: c.text,
    backgroundColor: c.surface,
  },
  counter: { alignSelf: 'flex-end' },
  doctorList: { gap: space[3] },
  doctorRow: { gap: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: c.border },
  doctorHead: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  doctorText: { flex: 1, gap: 2 },
  emergencyScreen: { flex: 1, backgroundColor: c.emergencyBg },
  emergencyContent: { flexGrow: 1, justifyContent: 'center', padding: space[6] },
  emergencyInner: {
    gap: space[4],
    alignItems: 'center',
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
  },
  emergencyTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 40,
    lineHeight: 48,
    color: c.onEmergency,
    textAlign: 'center',
  },
  emergencyCall: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    backgroundColor: c.onEmergency,
    borderRadius: radius.lg,
    paddingVertical: space[5],
    paddingHorizontal: space[4],
    minHeight: 72,
  },
  emergencyCallPressed: { backgroundColor: c.dangerBg },
  emergencyCallLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 26,
    lineHeight: 32,
    color: c.emergencyBg,
    textAlign: 'center',
    flexShrink: 1,
  },
}));
