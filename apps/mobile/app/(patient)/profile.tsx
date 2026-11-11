/**
 * Profile (UI Phase 3): header (initials avatar, name, phone, member since,
 * completion progress), "Afya yangu" summary cards (tap to edit — no BMI and
 * no judgement of weight), then grouped rows: account, language, app; sign
 * out behind a confirmation; app version at the bottom.
 */
import type { HealthProfileView } from '@daktari/schemas';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { DevStylePreviewEntry } from '../../src/components/dev-style-preview-entry';
import { useI18nStore, useT, type Locale } from '../../src/i18n';
import type { TranslationKey } from '../../src/i18n/translations';
import { errorMessage } from '../../src/lib/errors';
import { bloodTypeLabel } from '../../src/lib/labels';
import { monthYearLabel, profileCompletion } from '../../src/lib/profile-completion';
import { clearTokens } from '../../src/services/api';
import { authApi, patientApi } from '../../src/services/endpoints';
import { useAuthStore } from '../../src/stores/auth';
import { createStyles, layout, radius, space, useTheme } from '../../src/theme/theme';
import {
  Avatar,
  Card,
  ChipGroup,
  ConfirmDialog,
  ErrorState,
  Header,
  Icon,
  ProgressBar,
  Screen,
  Section,
  SkeletonCard,
  SkeletonGroup,
  Text,
  type IconName,
} from '../../src/ui';

const SEX_KEY = { MALE: 'health.sex.male', FEMALE: 'health.sex.female', UNDISCLOSED: 'health.sex.undisclosed' } as const;
const BP_KEY = {
  NONE: 'health.bp.none',
  YES_ON_MEDICATION: 'health.bp.treated',
  YES_NO_MEDICATION: 'health.bp.untreated',
  UNKNOWN: 'health.bp.unknown',
} as const;

export default function Profile(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const { locale, setLocale } = useI18nStore();
  const signOut = useAuthStore((state) => state.signOut);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const me = useQuery({ queryKey: ['me'], queryFn: () => authApi.me() });
  const profile = useQuery({ queryKey: ['profile', 'me'], queryFn: () => patientApi.myProfile() });
  const health = useQuery({ queryKey: ['health-profile', 'me'], queryFn: () => patientApi.healthProfile() });

  const completion = profile.data === undefined ? null : profileCompletion(profile.data);
  const version = Constants.expoConfig?.version ?? '—';
  const editHealth = (): void => router.push('/(patient)/health-profile');

  const logout = (): void => {
    setConfirmLogout(false);
    void clearTokens().then(() => {
      signOut();
      router.replace('/(auth)/login');
    });
  };

  return (
    <Screen header={<Header title={t('profile.title')} large />}>
      {/* Header card */}
      <Card>
        <View style={styles.identity}>
          <Avatar name={me.data?.user.fullName ?? '?'} size="lg" />
          <View style={styles.flexGap}>
            <Text variant="title">{me.data?.user.fullName ?? ' '}</Text>
            <Text tone="secondary">{me.data?.user.phone ?? ''}</Text>
            {me.data?.user.memberSince !== undefined ? (
              <Text variant="caption" tone="secondary">
                {t('profile.memberSince', { date: monthYearLabel(me.data.user.memberSince, locale) })}
              </Text>
            ) : null}
          </View>
        </View>
        {completion !== null ? (
          <View style={styles.completion}>
            <Text variant="label">{t('profile.completion', { percent: completion.percent })}</Text>
            <ProgressBar percent={completion.percent} accessibilityLabel={t('profile.completion.a11y', { percent: completion.percent })} />
            {completion.next !== null ? (
              <Text variant="caption" tone="secondary">
                {t('profile.completion.next', { step: t(`profile.completion.step.${completion.next}`) })}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      {/* Afya yangu */}
      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('profile.myHealth')}
          </Text>
        }
      >
        {health.isPending ? (
          <SkeletonGroup>
            <SkeletonCard />
          </SkeletonGroup>
        ) : health.isError ? (
          <Card>
            <ErrorState message={errorMessage(health.error)} onRetry={() => void health.refetch()} />
          </Card>
        ) : (
          <>
            {!health.data.completed ? <Text tone="secondary">{t('profile.myHealth.empty')}</Text> : null}
            <HealthCards view={health.data} onEdit={editHealth} />
            <Text variant="caption" tone="secondary">
              {t('profile.myHealth.edit')}
            </Text>
          </>
        )}
      </Section>

      {/* Account */}
      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('profile.section.account')}
          </Text>
        }
      >
        <Card padded={false} style={styles.group}>
          <Row icon="user" title={t('profile.row.personal')} subtitle={t('profile.row.personal.sub')} href="/(patient)/personal-info" />
          <Row icon="clipboard" title={t('profile.row.health')} subtitle={t('profile.row.health.sub')} href="/(patient)/health-profile" divider />
          <Row icon="lock" title={t('profile.row.privacy')} subtitle={t('profile.row.privacy.sub')} href="/(patient)/privacy-security" divider />
        </Card>
      </Section>

      {/* Language */}
      <Card>
        <View style={styles.rowInline}>
          <Icon name="globe" size={22} color={colors.primary} />
          <Text variant="bodyStrong" style={styles.flex}>
            {t('profile.row.language')}
          </Text>
        </View>
        <ChipGroup<Locale>
          options={[
            { value: 'sw', label: t('profile.language.sw') },
            { value: 'en', label: t('profile.language.en') },
          ]}
          value={locale}
          onChange={setLocale}
        />
      </Card>

      {/* App */}
      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('profile.section.app')}
          </Text>
        }
      >
        <Card padded={false} style={styles.group}>
          <Row icon="help-circle" title={t('profile.row.help')} subtitle={t('profile.row.help.sub')} href="/(patient)/help" />
          <Row
            icon="file-text"
            title={t('profile.row.legal')}
            subtitle={t('profile.row.legal.sub')}
            href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }}
            divider
          />
          <Row icon="log-out" title={t('auth.logout')} onPress={() => setConfirmLogout(true)} divider danger />
        </Card>
      </Section>

      <Text variant="caption" tone="secondary" align="center">
        {t('profile.version', { version })}
      </Text>
      <DevStylePreviewEntry />

      <ConfirmDialog
        visible={confirmLogout}
        title={t('profile.logout.title')}
        message={t('profile.logout.body')}
        confirmLabel={t('profile.logout.confirm')}
        cancelLabel={t('profile.logout.cancel')}
        icon="log-out"
        onConfirm={logout}
        onCancel={() => setConfirmLogout(false)}
      />
    </Screen>
  );
}

/** Six tap-to-edit cards. Plain facts only — no BMI, no "overweight" labels. */
function HealthCards({ view, onEdit }: { view: HealthProfileView; onEdit: () => void }): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const notGiven = t('profile.card.notGiven');
  const cards: Array<{ icon: IconName; label: TranslationKey; value: string }> = [
    { icon: 'calendar', label: 'profile.card.age', value: view.age === null ? notGiven : t('profile.card.years', { years: view.age }) },
    { icon: 'user', label: 'profile.card.sex', value: view.sex === null ? notGiven : t(SEX_KEY[view.sex]) },
    { icon: 'maximize-2', label: 'profile.card.height', value: view.heightCm === null ? notGiven : `${view.heightCm} cm` },
    { icon: 'activity', label: 'profile.card.weight', value: view.weightKg === null ? notGiven : `${view.weightKg} kg` },
    { icon: 'heart', label: 'profile.card.bp', value: view.bpHistory === null ? notGiven : t(BP_KEY[view.bpHistory]) },
    {
      icon: 'droplet',
      label: 'profile.card.blood',
      value: view.bloodGroup === null ? notGiven : view.bloodGroup === 'UNKNOWN' ? t('health.bloodGroup.unknown') : bloodTypeLabel(view.bloodGroup),
    },
  ];
  return (
    <View style={styles.cards}>
      {cards.map((card) => (
        <Card key={card.label} onPress={onEdit} accessibilityLabel={`${t(card.label)}: ${card.value}`} style={styles.healthCard}>
          <Icon name={card.icon} size={20} color={styles.cardIcon.color} />
          <Text variant="caption" tone="secondary">
            {t(card.label)}
          </Text>
          <Text variant="bodyStrong" tone={card.value === notGiven ? 'secondary' : 'default'}>
            {card.value}
          </Text>
        </Card>
      ))}
    </View>
  );
}

function Row({
  icon,
  title,
  subtitle,
  href,
  onPress,
  divider = false,
  danger = false,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  href?: Href;
  onPress?: () => void;
  divider?: boolean;
  danger?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const tint = danger ? colors.dangerFg : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle !== undefined ? `${title}. ${subtitle}` : title}
      onPress={onPress ?? (() => href !== undefined && router.push(href))}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <View style={styles.flexGap}>
        <Text variant="bodyStrong" style={danger ? { color: colors.dangerFg } : undefined}>
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {danger ? null : <Icon name="chevron-right" size={20} color={colors.textSecondary} />}
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  identity: { flexDirection: 'row', gap: space[4], alignItems: 'center' },
  flex: { flex: 1 },
  flexGap: { flex: 1, gap: 2 },
  completion: { gap: space[2], marginTop: space[2] },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  healthCard: { flexGrow: 1, flexBasis: 140, gap: space[1] },
  cardIcon: { color: c.primary },
  group: { overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 64,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  divider: { borderTopWidth: layout.hairline, borderTopColor: c.border },
  pressed: { backgroundColor: c.primarySoft },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: c.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconDanger: { backgroundColor: c.dangerBg },
  rowInline: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
}));
