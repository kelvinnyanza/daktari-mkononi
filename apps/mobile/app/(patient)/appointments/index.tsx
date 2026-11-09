import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl } from 'react-native';
import { useT } from '../../../src/i18n';
import { eatDateTimeLabel } from '../../../src/lib/datetime';
import { errorMessage } from '../../../src/lib/errors';
import { appointmentApi, type AppointmentItem } from '../../../src/services/endpoints';
import { useTheme } from '../../../src/theme/theme';
import {
  AppointmentStatusPill,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  Header,
  IconTile,
  ListItem,
  Screen,
  SkeletonGroup,
  SkeletonListItem,
  type IconName,
} from '../../../src/ui';

type Filter = 'upcoming' | 'past';

const TYPE_ICON: Record<AppointmentItem['type'], IconName> = {
  VIDEO: 'video',
  AUDIO: 'phone',
  CHAT: 'message-square',
  IN_PERSON: 'map-pin',
};

export default function Appointments(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
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
    <Screen
      header={<Header title={t('appointments.title')} large />}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      <ChipGroup
        options={[
          { value: 'upcoming', label: t('appointments.upcoming') },
          { value: 'past', label: t('appointments.past') },
        ]}
        value={filter}
        onChange={setFilter}
      />
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
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="calendar"
            title={filter === 'upcoming' ? t('appointments.none.upcoming') : t('appointments.none.past')}
            {...(filter === 'upcoming'
              ? {
                  action: {
                    label: t('doctors.title'),
                    icon: 'search' as const,
                    onPress: () => router.push('/(patient)/doctors'),
                  },
                }
              : {})}
          />
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {items.map((item, index) => (
            <ListItem
              key={item.id}
              title={eatDateTimeLabel(item.scheduledAt)}
              subtitle={item.reason}
              leading={<IconTile icon={TYPE_ICON[item.type]} tone={filter === 'upcoming' ? 'primary' : 'neutral'} />}
              meta={<AppointmentStatusPill status={item.status} />}
              onPress={() => router.push({ pathname: '/(patient)/appointments/[id]', params: { id: item.id } })}
              divider={index < items.length - 1}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
