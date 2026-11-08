import { useRouter } from 'expo-router';
import { useT } from '../../src/i18n';
import { EmptyState, Header, Screen } from '../../src/ui';

/** 2FA challenge shape is parked: the API can answer 2FA_REQUIRED, but the
 *  mobile flow lands in a later phase. */
export default function TwoFactor(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  return (
    <Screen header={<Header title={t('auth.twoFactor.title')} onBack={() => router.back()} />}>
      <EmptyState
        icon="shield"
        title={t('auth.twoFactor.title')}
        message={t('auth.twoFactor.notSupported')}
        action={{ label: t('common.back'), onPress: () => router.back(), icon: 'arrow-left' }}
      />
    </Screen>
  );
}
