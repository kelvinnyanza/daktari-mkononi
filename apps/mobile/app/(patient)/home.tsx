import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { eatDateTimeLabel } from '../../src/lib/datetime';
import { appointmentApi } from '../../src/services/endpoints';
import { space } from '../../src/theme/theme';
import {
  AppointmentStatusPill,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconTile,
  ListItem,
  Logo,
  Screen,
  Section,
  SkeletonGroup,
  SkeletonListItem,
  Text,
  type IconName,
} from '../../src/ui';

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
      <View style={{ paddingTop: space[4], gap: space[4] }}>
        <Logo size="sm" />
        <View style={{ gap: space[1] }}>
          <Text variant="display" accessibilityRole="header">
            {t(greetingKey(new Date().getHours()))}
          </Text>
          <Text tone="secondary">{t('home.ask')}</Text>
        </View>
      </View>

      <Card tone="primary">
        <Text variant="heading">{t('screening.title')}</Text>
        <Text>{t('home.screening.body')}</Text>
        <Button label={t('home.startScreening')} icon="message-circle" onPress={() => router.push('/(patient)/screening')} />
      </Card>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        <QuickAction icon="search" label={t('doctors.title')} onPress={() => router.push('/(patient)/doctors')} />
        <QuickAction icon="file-text" label={t('records.title')} onPress={() => router.push('/(patient)/records')} />
      </View>

      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('home.upcoming.title')}
          </Text>
        }
        action={
          <Button
            variant="ghost"
            size="sm"
            label={t('home.seeAll')}
            fullWidth={false}
            onPress={() => router.push('/(patient)/appointments')}
          />
        }
      >
        {appointments.isPending ? (
          <SkeletonGroup>
            <SkeletonListItem />
          </SkeletonGroup>
        ) : appointments.isError ? (
          <Card>
            <ErrorState message={errorMessage(appointments.error)} onRetry={() => void appointments.refetch()} />
          </Card>
        ) : upcoming !== undefined ? (
          <Card padded={false} style={{ overflow: 'hidden' }}>
            <ListItem
              title={eatDateTimeLabel(upcoming.scheduledAt)}
              subtitle={upcoming.reason}
              leading={<IconTile icon="calendar" />}
              meta={<AppointmentStatusPill status={upcoming.status} />}
              onPress={() => router.push({ pathname: '/(patient)/appointments/[id]', params: { id: upcoming.id } })}
            />
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon="calendar"
              title={t('home.upcoming.none')}
              action={{ label: t('doctors.title'), icon: 'search', onPress: () => router.push('/(patient)/doctors') }}
            />
          </Card>
        )}
      </Section>
    </Screen>
  );
}

function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Card onPress={onPress} accessibilityLabel={label} style={{ flexGrow: 1, flexBasis: 140 }}>
      <IconTile icon={icon} />
      <Text variant="bodyStrong">{label}</Text>
    </Card>
  );
}

