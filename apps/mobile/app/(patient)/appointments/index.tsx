import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Body,
  ChipRow,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Title,
} from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/lib/errors';
import { appointmentApi, type AppointmentItem } from '../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

type Filter = 'upcoming' | 'past';

export default function Appointments(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('upcoming');
  const query = useQuery({
    queryKey: ['appointments', 'me'],
    queryFn: () => appointmentApi.listMine(),
  });

  const now = Date.now();
  const isUpcoming = (item: AppointmentItem): boolean =>
    new Date(item.scheduledAt).getTime() >= now &&
    item.status !== 'CANCELLED' &&
    item.status !== 'NO_SHOW' &&
    item.status !== 'COMPLETED';
  const items = (query.data?.items ?? []).filter((item) =>
    filter === 'upcoming' ? isUpcoming(item) : !isUpcoming(item),
  );

  return (
    <Screen>
      <Title>{t('appointments.title')}</Title>
      <ChipRow
        options={[
          { value: 'upcoming', label: t('appointments.upcoming') },
          { value: 'past', label: t('appointments.past') },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          message={filter === 'upcoming' ? t('appointments.none.upcoming') : t('appointments.none.past')}
        />
      ) : (
        items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/(patient)/appointments/[id]', params: { id: item.id } })}
            style={styles.card}
          >
            <Text style={styles.cardTitle}>{new Date(item.scheduledAt).toLocaleString()}</Text>
            <Body>{item.reason}</Body>
            <View style={styles.statusRow}>
              <Body muted>{t(`appointments.status.${item.status}`)}</Body>
            </View>
          </Pressable>
        ))
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
  statusRow: { flexDirection: 'row' },
});
