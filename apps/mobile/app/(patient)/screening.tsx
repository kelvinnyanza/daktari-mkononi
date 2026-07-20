/**
 * Screening chat (Phase 9). The SERVER drives all triage logic; this screen
 * renders responses and reacts to status. EMERGENCY takes over the whole
 * screen with tap-to-call 112/115; 429s render the server's bilingual
 * message VERBATIM (it carries the emergency guidance).
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Body, Button, ErrorState, LoadingState, Title } from '../../src/components/ui';
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
import { formatTzs } from '../../src/lib/money';
import { screeningApi } from '../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../src/theme/tokens';

const MAX_LEN = 500;

export default function ScreeningScreen(): React.JSX.Element {
  const t = useT();
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
  if (state.phase === 'emergency') {
    const lastMessage = state.messages.at(-1)?.content ?? '';
    return (
      <View style={styles.emergencyScreen} accessibilityRole="alert">
        <Text style={styles.emergencyTitle}>{t('screening.emergency.title')}</Text>
        <Text style={styles.emergencyBody}>{lastMessage}</Text>
        <Text style={styles.emergencyInstruction}>{t('screening.emergency.instruction')}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.emergencyCall}
          onPress={() => void Linking.openURL('tel:112')}
        >
          <Text style={styles.emergencyCallLabel}>{t('screening.emergency.call112')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.emergencyCall}
          onPress={() => void Linking.openURL('tel:115')}
        >
          <Text style={styles.emergencyCallLabel}>{t('screening.emergency.call115')}</Text>
        </Pressable>
      </View>
    );
  }

  if (resuming) return <LoadingState />;

  if (state.phase === 'idle' || state.phase === 'starting') {
    return (
      <View style={styles.container}>
        <View style={styles.startBox}>
          <Title>{t('screening.title')}</Title>
          {state.error !== null ? (
            <ErrorState message={state.error} onRetry={() => void start()} />
          ) : (
            <Button
              label={t('screening.start')}
              onPress={() => void start()}
              disabled={state.phase === 'starting'}
            />
          )}
        </View>
      </View>
    );
  }

  if (state.phase === 'expired') {
    return (
      <View style={styles.container}>
        <View style={styles.startBox}>
          <Body>{t('screening.expired')}</Body>
          <Button label={t('screening.newSession')} onPress={() => void startFresh()} />
        </View>
      </View>
    );
  }

  const completed = state.phase === 'completed';
  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollRef}
        style={styles.chat}
        contentContainerStyle={styles.chatContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {state.messages.map((message, index) => (
          <View
            key={index}
            style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
          >
            <Text style={message.role === 'user' ? styles.bubbleUserText : styles.bubbleText}>
              {message.content}
            </Text>
          </View>
        ))}
        {state.phase === 'sending' ? (
          <View style={[styles.bubble, styles.bubbleAssistant]}>
            <Text style={styles.typing}>{t('screening.typing')}</Text>
          </View>
        ) : null}
        {state.error !== null ? <Text style={styles.errorText}>{state.error}</Text> : null}

        {completed && state.triage !== null && state.triage.triageLevel !== 'EMERGENCY' ? (
          <View style={styles.triageCard}>
            <Text style={styles.triageTitle}>{t('screening.triage.title')}</Text>
            <Body>
              {state.triage.triageLevel === 'SELF_CARE'
                ? t('screening.triage.SELF_CARE')
                : state.triage.triageLevel === 'IN_PERSON_VISIT'
                  ? t('screening.triage.IN_PERSON_VISIT')
                  : t('screening.triage.TELECONSULTATION')}
            </Body>
            {state.suggestedDoctors.length > 0 ? (
              <View style={styles.doctorList}>
                <Text style={styles.triageTitle}>{t('screening.doctors.title')}</Text>
                {state.suggestedDoctors.map((doctor) => (
                  <SuggestedDoctorRow key={doctor.id} doctor={doctor} sessionId={state.sessionId} />
                ))}
              </View>
            ) : null}
            <Button label={t('screening.newSession')} onPress={() => void startFresh()} />
          </View>
        ) : null}
      </ScrollView>

      {!completed ? (
        <View style={styles.inputRow}>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={(text) => setDraft(text.slice(0, MAX_LEN))}
              placeholder={t('screening.inputPlaceholder')}
              placeholderTextColor={colors.textMuted}
              editable={state.phase === 'active'}
              multiline
              accessibilityLabel={t('screening.inputPlaceholder')}
            />
            <Text style={styles.counter}>{`${draft.length}/${MAX_LEN}`}</Text>
          </View>
          <Button
            label={t('screening.send')}
            onPress={() => void send()}
            disabled={state.phase !== 'active' || draft.trim().length === 0}
          />
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
  return (
    <View style={styles.doctorRow}>
      <View style={styles.doctorInfo}>
        <Text style={styles.doctorName}>{doctor.fullName}</Text>
        <Text style={styles.doctorMeta}>
          {`${doctor.specialty} · ${formatTzs(doctor.consultationFeeTzs)} · ★ ${doctor.averageRating.toFixed(1)}`}
        </Text>
      </View>
      <Button
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  startBox: { padding: spacing.lg, gap: spacing.md, marginTop: spacing.xl },
  chat: { flex: 1 },
  chatContent: { padding: spacing.md, gap: spacing.sm },
  bubble: {
    maxWidth: '85%',
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
  },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleText: { ...typography.body, color: colors.text },
  bubbleUserText: { ...typography.body, color: colors.onPrimary },
  typing: { ...typography.body, color: colors.textMuted, fontStyle: 'italic' },
  errorText: { ...typography.body, color: colors.danger, paddingVertical: spacing.sm },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  inputBox: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm,
    maxHeight: 120,
    ...typography.body,
    color: colors.text,
  },
  counter: { ...typography.caption, color: colors.textMuted, alignSelf: 'flex-end' },
  triageCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  triageTitle: { ...typography.subtitle, color: colors.text },
  doctorList: { gap: spacing.sm },
  doctorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  doctorInfo: { flex: 1 },
  doctorName: { ...typography.body, color: colors.text, fontWeight: '600' },
  doctorMeta: { ...typography.caption, color: colors.textMuted },
  emergencyScreen: {
    flex: 1,
    backgroundColor: colors.danger,
    padding: spacing.lg,
    gap: spacing.md,
    justifyContent: 'center',
  },
  emergencyTitle: { fontSize: 40, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  emergencyBody: { ...typography.body, color: '#FFFFFF', textAlign: 'center' },
  emergencyInstruction: {
    ...typography.subtitle,
    color: '#FFFFFF',
    textAlign: 'center',
    fontWeight: '700',
  },
  emergencyCall: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emergencyCallLabel: { fontSize: 28, fontWeight: '800', color: colors.danger },
});
