import { useRouter } from 'expo-router';
import { Body, Button, Screen, Title } from '../src/components/ui';
import { useT } from '../src/i18n';
import { clearTokens } from '../src/services/api';
import { useAuthStore } from '../src/stores/auth';

export default function DoctorComingSoon(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const signOut = useAuthStore((state) => state.signOut);

  return (
    <Screen>
      <Title>{t('doctor.comingSoon.title')}</Title>
      <Body>{t('doctor.comingSoon.body')}</Body>
      <Button
        label={t('auth.logout')}
        onPress={() => {
          void clearTokens().then(() => {
            signOut();
            router.replace('/(auth)/login');
          });
        }}
      />
    </Screen>
  );
}
