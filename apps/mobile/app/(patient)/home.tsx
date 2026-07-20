import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Button, ErrorState, LoadingState, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { appointmentApi } from '../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../src/theme/tokens';

function greetingKey(hour: number): 'home.greeting.morning' | 'home.greeting.afternoon' | 'home.greeting.evening' {
  if (hour < 12) return 'home.greeting.morning';
  if (hour < 17) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

export default function Home(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const appointments = useQuery({
    queryKey: ['appointments', 'me'],
    queryFn: () => appointmentApi.listMine(),
  });

  const upcoming = appointments.data?.items
    .filter((item) => item.status === 'CONFIRMED' && new Date(item.scheduledAt) > new Date())
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];

  return (
    <Screen>
      <Title>{t(greetingKey(new Date().getHours()))}</Title>

      <Button label={t('home.startScreening')} onPress={() => router.push('/(patient)/screening')} />
      <Button label={t('doctors.title')} onPress={() => router.push('/(patient)/doctors')} />

      <Body muted>{t('home.upcoming.title')}</Body>
      {appointments.isPending ? (
        <LoadingState />
      ) : appointments.isError ? (
        <ErrorState
          message={errorMessage(appointments.error)}
          onRetry={() => void appointments.refetch()}
        />
      ) : upcoming !== undefined ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{new Date(upcoming.scheduledAt).toLocaleString()}</Text>
          <Body>{upcoming.reason}</Body>
          <Body muted>{t(`appointments.status.${upcoming.status}`)}</Body>
        </View>
      ) : (
        <Body muted>{t('home.upcoming.none')}</Body>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardTitle: { ...typography.subtitle, color: colors.text },
});
