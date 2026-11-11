/**
 * Profile → Faragha na usalama: change password (the existing OTP reset
 * flow, phone prefilled) and the health-data consent status.
 */
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useI18nStore, useT } from '../../src/i18n';
import { dayMonthYearLabel } from '../../src/lib/profile-completion';
import { authApi, patientApi } from '../../src/services/endpoints';
import { Button, Card, Header, Screen, Text } from '../../src/ui';

export default function PrivacySecurity(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const locale = useI18nStore((state) => state.locale);
  const me = useQuery({ queryKey: ['me'], queryFn: () => authApi.me() });
  const health = useQuery({ queryKey: ['health-profile', 'me'], queryFn: () => patientApi.healthProfile() });
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/(patient)/profile'));
  const consentAt = health.data?.consentGivenAt ?? null;

  return (
    <Screen header={<Header title={t('privacy.title')} onBack={back} />}>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('privacy.password')}
        </Text>
        <Text tone="secondary">{t('privacy.password.body')}</Text>
        <Button
          variant="secondary"
          icon="lock"
          label={t('privacy.password')}
          onPress={() =>
            router.push({ pathname: '/(auth)/forgot-password', params: { phone: me.data?.user.phone ?? '' } })
          }
        />
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('privacy.consent')}
        </Text>
        <Text tone="secondary">
          {consentAt !== null ? t('privacy.consent.given', { date: dayMonthYearLabel(consentAt, locale) }) : t('privacy.consent.none')}
        </Text>
        <Button
          variant="ghost"
          icon="shield"
          label={t('privacy.policy')}
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
        />
      </Card>
    </Screen>
  );
}
