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
import { ActivityIndicator, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { waitingRoomView } from '../../../../src/features/consultation/waiting-room';
import { useT } from '../../../../src/i18n';
import { ratingApi } from '../../../../src/services/endpoints';
import { space, useTheme } from '../../../../src/theme/theme';
import { Banner, Button, Card, EmptyState, Header, Screen } from '../../../../src/ui';

export default function WaitingRoom(): React.JSX.Element {
  const t = useT();
  const { colors } = useTheme();
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
    <Screen header={<Header title={t('consult.waiting.title')} onBack={() => router.back()} />}>
      <Card>
        <EmptyState
          icon={target !== null ? 'video' : 'clock'}
          title={t(view.statusKey)}
          {...(target === null ? { message: t('consult.waiting.hint') } : {})}
        />
        {target === null ? (
          <View style={{ alignItems: 'center', paddingBottom: space[4] }}>
            <ActivityIndicator color={colors.primary} accessibilityLabel={t('consult.waiting.status.connecting')} />
          </View>
        ) : null}
      </Card>
      {target === null ? <Banner tone="info" icon="wifi" message={t('consult.waiting.tip')} /> : null}
      {target !== null ? <Button icon="video" label={t('consult.join')} onPress={() => enter(target)} /> : null}
      <Button variant="ghost" icon="arrow-left" label={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
