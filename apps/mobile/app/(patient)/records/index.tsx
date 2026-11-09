import { useQuery } from '@tanstack/react-query';
import { RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useT } from '../../../src/i18n';
import { eatDateTimeLabel } from '../../../src/lib/datetime';
import { errorMessage } from '../../../src/lib/errors';
import { recordsApi } from '../../../src/services/endpoints';
import { useTheme } from '../../../src/theme/theme';
import {
  Card,
  EmptyState,
  ErrorState,
  Header,
  IconTile,
  ListItem,
  Screen,
  SkeletonGroup,
  SkeletonListItem,
  Text,
} from '../../../src/ui';

export default function Records(): React.JSX.Element {
  const t = useT();
  const { colors } = useTheme();
  const query = useQuery({
    queryKey: ['records', 'me'],
    queryFn: () => recordsApi.listMine(),
  });

  return (
    <Screen
      header={<Header title={t('records.title')} large />}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      {query.isPending ? (
        <Card>
          <SkeletonGroup>
            <SkeletonListItem />
            <SkeletonListItem />
          </SkeletonGroup>
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </Card>
      ) : query.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon="file-text"
            title={t('records.none')}
            message={t('records.none.body')}
            action={{ label: t('home.startScreening'), icon: 'message-circle', onPress: () => router.push('/(patient)/screening') }}
          />
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {query.data.items.map((record, index) => (
            <ListItem
              key={record.id}
              title={record.title}
              {...(record.summary !== null ? { subtitle: record.summary } : {})}
              leading={<IconTile icon={record.addendumToId !== null ? 'edit-3' : 'file-text'} />}
              meta={
                <Text variant="caption" tone="secondary">
                  {eatDateTimeLabel(record.createdAt)}
                </Text>
              }
              onPress={() => router.push({ pathname: '/(patient)/records/[id]', params: { id: record.id } })}
              divider={index < query.data.items.length - 1}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
