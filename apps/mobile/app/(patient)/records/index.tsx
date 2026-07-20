import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Body, EmptyState, ErrorState, LoadingState, Screen, Title } from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { eatDateTimeLabel } from '../../../src/lib/datetime';
import { errorMessage } from '../../../src/lib/errors';
import { recordsApi } from '../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

export default function Records(): React.JSX.Element {
  const t = useT();
  const query = useQuery({
    queryKey: ['records', 'me'],
    queryFn: () => recordsApi.listMine(),
  });

  return (
    <Screen>
      <Title>{t('records.title')}</Title>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : query.data.items.length === 0 ? (
        <EmptyState message={t('records.none')} />
      ) : (
        query.data.items.map((record) => (
          <Pressable
            key={record.id}
            accessibilityRole="button"
            style={styles.card}
            onPress={() =>
              router.push({ pathname: '/(patient)/records/[id]', params: { id: record.id } })
            }
          >
            <Text style={styles.cardTitle}>{record.title}</Text>
            {record.summary !== null ? <Body muted>{record.summary}</Body> : null}
            <Body muted>{eatDateTimeLabel(record.createdAt)}</Body>
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
});
