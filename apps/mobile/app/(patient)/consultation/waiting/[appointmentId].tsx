/**
 * Waiting room. The consultation channel is per-consultation and can't be
 * joined before the doctor starts it, so the room polls the appointment's
 * consultation status (5s); once it exists and is IN_PROGRESS it auto-
 * transitions into the call. COMPLETED/ABANDONED route to the appropriate
 * end state.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Body, Button, Title } from '../../../../src/components/ui';
import { useT } from '../../../../src/i18n';
import { ratingApi } from '../../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../../src/theme/tokens';

export default function WaitingRoom(): React.JSX.Element {
  const t = useT();
  const { appointmentId } = useLocalSearchParams<{ appointmentId: string }>();

  // statusForAppointment returns { consultationId, status } once it exists
  // (404 before the doctor starts — react-query treats it as an error we poll
  // through). Poll every 5s.
  const status = useQuery({
    queryKey: ['consultation-status', appointmentId],
    queryFn: () => ratingApi.statusForAppointment(appointmentId ?? ''),
    refetchInterval: 5_000,
    retry: false,
  });

  useEffect(() => {
    if (status.data === undefined) return;
    if (status.data.status === 'IN_PROGRESS') {
      router.replace({ pathname: '/(patient)/consultation/[id]', params: { id: status.data.consultationId } });
    } else if (status.data.status === 'COMPLETED') {
      router.replace({ pathname: '/(patient)/consultation/[id]', params: { id: status.data.consultationId } });
    }
  }, [status.data]);

  const connectionKey = status.isError
    ? 'consult.waiting.status.connecting' // no consultation yet — still waiting
    : status.isPending
      ? 'consult.waiting.status.connecting'
      : 'consult.waiting.status.open';

  return (
    <View style={styles.container}>
      <Title>{t('consult.waiting.title')}</Title>
      <View style={styles.card}>
        <Text style={styles.status}>{t(connectionKey)}</Text>
        <Body muted>{t('consult.waiting.hint')}</Body>
      </View>
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
