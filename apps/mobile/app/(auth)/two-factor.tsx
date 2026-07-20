import { useRouter } from 'expo-router';
import { Body, Button, Screen, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';

/** 2FA challenge shape is parked: the API can answer 2FA_REQUIRED, but the
 *  mobile flow lands in a later phase. */
export default function TwoFactor(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  return (
    <Screen>
      <Title>{t('auth.twoFactor.title')}</Title>
      <Body>{t('auth.twoFactor.notSupported')}</Body>
      <Button label={t('common.back')} onPress={() => router.back()} />
    </Screen>
  );
}
