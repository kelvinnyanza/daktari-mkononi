/**
 * Waiting room. The consultation channel is per-consultation and can't be
 * joined before the doctor starts it, so the room polls the appointment's
 * consultation status (5s). Whenever that status is IN_PROGRESS — including
 * when it ALREADY was on entry (a rejoin) — it goes straight into the call;
 * COMPLETED routes to the end state. A visible "Join" button backs up the
 * automatic redirect, so the patient can never be stuck here.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Body, Button, Title } from '../../../../src/components/ui';
import { waitingRoomView } from '../../../../src/features/consultation/waiting-room';
import { useT } from '../../../../src/i18n';
import { ratingApi } from '../../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../../src/theme/tokens';

export default function WaitingRoom(): React.JSX.Element {
  const t = useT();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();

  // statusForAppointment returns { consultationId, status } once it exists
  // (404 before the doctor starts — react-query treats it as an error we poll
  // through). Poll every 5s; always refetch on entry, never trust the cache.
  const status = useQuery({
    queryKey: ['consultation-status', appointmentId],
    queryFn: () => ratingApi.statusForAppointment(appointmentId ?? ''),
    refetchInterval: 5_000,
    refetchOnMount: 'always',
    retry: false,
  });

  const view = waitingRoomView({ data: status.data, isError: status.isError });
  const target = view.enterConsultationId;

  const enter = useCallback((consultationId: string) => {
    router.replace({ pathname: '/(patient)/consultation/[id]', params: { id: consultationId } });
  }, []);

  // Keyed on the primitive id and run on focus — not on a data-object change,
  // which never happens when the status was already IN_PROGRESS on entry.
  useFocusEffect(
    useCallback(() => {
      if (target !== null) enter(target);
    }, [target, enter]),
  );

  return (
    <View style={styles.container}>
      <Title>{t('consult.waiting.title')}</Title>
      <View style={styles.card}>
        <Text style={styles.status}>{t(view.statusKey)}</Text>
        {target === null ? <Body muted>{t('consult.waiting.hint')}</Body> : null}
      </View>
      {target !== null ? <Button label={t('consult.join')} onPress={() => enter(target)} /> : null}
      <Button label={t('common.back')} onPress={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  status: { ...typography.subtitle, color: colors.text },
});
