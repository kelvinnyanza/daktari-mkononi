/**
 * Home (UI Phase 3): warm greeting with the patient's first name and avatar,
 * the health-tips carousel, quick actions, the next appointment (with Join
 * when allowed) and the health-profile card while it is incomplete.
 */
import type { PublicHealthTip } from '@daktari/schemas';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';
import { consultationEntry } from '../../src/features/consultation/waiting-room';
import { useHomeTips } from '../../src/features/tips/hooks';
import { TipsCarousel } from '../../src/features/tips/TipsCarousel';
import { useT } from '../../src/i18n';
import { eatDateTimeLabel } from '../../src/lib/datetime';
import { errorMessage } from '../../src/lib/errors';
import { appointmentApi, authApi, patientApi } from '../../src/services/endpoints';
import { createStyles, radius, space } from '../../src/theme/theme';
import {
  AppointmentStatusPill,
  Avatar,
  Banner,
  Button,
  Card,
  EmptyState,
  ErrorState,
  firstName,
  IconTile,
  Section,
  Screen,
  SkeletonCard,
  SkeletonGroup,
  SkeletonListItem,
  Text,
  type IconName,
} from '../../src/ui';

/** Time of day on the EAT clock (UTC+3, no DST), whatever the device timezone. */
function greetingKey(now: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = (now.getUTCHours() + 3) % 24;
  if (hour >= 4 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}

const QUICK_ACTIONS: ReadonlyArray<{ icon: IconName; label: 'home.quick.screening' | 'home.quick.doctors' | 'home.quick.appointments' | 'home.quick.records'; href: Href }> = [
  { icon: 'message-circle', label: 'home.quick.screening', href: '/(patient)/screening' },
  { icon: 'search', label: 'home.quick.doctors', href: '/(patient)/doctors' },
  { icon: 'calendar', label: 'home.quick.appointments', href: '/(patient)/appointments' },
  { icon: 'file-text', label: 'home.quick.records', href: '/(patient)/records' },
];

export default function Home(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const styles = useStyles();
  const me = useQuery({ queryKey: ['me'], queryFn: () => authApi.me(), staleTime: 10 * 60_000 });
  const appointments = useQuery({ queryKey: ['appointments', 'me'], queryFn: () => appointmentApi.listMine() });
  // Same cache entry as Profile; the card only shows once we KNOW it's incomplete.
  const profile = useQuery({ queryKey: ['profile', 'me'], queryFn: () => patientApi.myProfile() });
  const tips = useHomeTips();

  const now = new Date();
  const name = firstName(me.data?.user.fullName ?? '');
  const greeting = greetingKey(now);
  const next = appointments.data?.items
    .filter(
      (item) =>
        item.status === 'IN_PROGRESS' || (item.status === 'CONFIRMED' && new Date(item.scheduledAt).getTime() > now.getTime() - 60 * 60_000),
    )
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  const entry = next === undefined ? null : consultationEntry(next, now);

  const openTip = (tip: PublicHealthTip): void => router.push({ pathname: '/(patient)/tips/[slug]', params: { slug: tip.slug } });

  return (
    <Screen>
      {/* Warm header: greeting by EAT time of day + first name, avatar → Profile. */}
      <View style={styles.header}>
        <View style={styles.greeting}>
          <Text variant="display" accessibilityRole="header">
            {name === '' ? t(`home.greeting.${greeting}`) : t(`home.greeting.${greeting}.named`, { name })}
          </Text>
          <Text tone="secondary">{t('home.ask')}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('home.avatar.a11y')}
          onPress={() => router.push('/(patient)/profile')}
          hitSlop={8}
        >
          <Avatar name={me.data?.user.fullName ?? '?'} size="md" />
        </Pressable>
      </View>

      {profile.data?.healthProfileCompleted === false ? (
        <Card>
          <View style={styles.row}>
            <IconTile icon="clipboard" />
            <View style={styles.flexGap}>
              <Text variant="heading">{t('health.card.title')}</Text>
              <Text tone="secondary">{t('health.card.body')}</Text>
            </View>
          </View>
          <Button
            variant="secondary"
            icon="edit-3"
            label={t('health.card.action')}
            onPress={() => router.push('/(patient)/health-profile')}
            testID="home-health-card"
          />
        </Card>
      ) : null}

      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('home.tips.title')}
          </Text>
        }
        action={<Button variant="ghost" size="sm" fullWidth={false} label={t('tips.all')} onPress={() => router.push('/(patient)/tips')} />}
      >
        {tips.isPending ? (
          <SkeletonGroup>
            <SkeletonCard />
          </SkeletonGroup>
        ) : tips.isError ? (
          <Card>
            <ErrorState kind="offline" message={t('tips.unavailable')} onRetry={() => void tips.refetch()} />
          </Card>
        ) : tips.data.tips.length === 0 ? (
          <Card>
            <EmptyState icon="book-open" title={t('tips.empty')} />
          </Card>
        ) : (
          <>
            {tips.data.offline ? <Banner tone="warning" icon="wifi-off" message={t('tips.offline')} /> : null}
            <TipsCarousel tips={tips.data.tips} onOpen={openTip} />
          </>
        )}
      </Section>

      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('home.quick.title')}
          </Text>
        }
      >
        <View style={styles.grid}>
          {QUICK_ACTIONS.map((action) => (
            <Card
              key={action.label}
              onPress={() => router.push(action.href)}
              accessibilityLabel={t(action.label)}
              style={styles.quick}
            >
              <IconTile icon={action.icon} />
              <Text variant="bodyStrong">{t(action.label)}</Text>
            </Card>
          ))}
        </View>
      </Section>

      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('home.next.title')}
          </Text>
        }
        action={
          <Button variant="ghost" size="sm" label={t('home.seeAll')} fullWidth={false} onPress={() => router.push('/(patient)/appointments')} />
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
        ) : next !== undefined ? (
          <Card>
            <View style={styles.row}>
              <IconTile icon="calendar" />
              <View style={styles.flexGap}>
                <Text variant="bodyStrong">{eatDateTimeLabel(next.scheduledAt)}</Text>
                {next.reason !== null && next.reason !== '' ? <Text tone="secondary">{next.reason}</Text> : null}
                <AppointmentStatusPill status={next.status} />
              </View>
            </View>
            {entry !== null ? (
              <Button
                icon={entry === 'join' ? 'video' : 'log-in'}
                label={t(entry === 'join' ? 'consult.join' : 'consult.enterWaitingRoom')}
                onPress={() =>
                  router.push({ pathname: '/(patient)/consultation/waiting/[appointmentId]', params: { appointmentId: next.id } })
                }
                testID="home-join"
              />
            ) : (
              <Button
                variant="secondary"
                label={t('home.next.open')}
                onPress={() => router.push({ pathname: '/(patient)/appointments/[id]', params: { id: next.id } })}
              />
            )}
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

const useStyles = createStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingTop: space[4] },
  greeting: { flex: 1, gap: space[1] },
  row: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  flexGap: { flex: 1, gap: space[1] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  quick: { flexGrow: 1, flexBasis: 140, borderRadius: radius.lg },
}));
