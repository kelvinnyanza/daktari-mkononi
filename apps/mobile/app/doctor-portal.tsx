import { useRouter } from 'expo-router';
import { useT } from '../src/i18n';
import { clearTokens } from '../src/services/api';
import { useAuthStore } from '../src/stores/auth';
import { Button, EmptyState, Logo, Screen } from '../src/ui';

/** Doctors use the web portal; the mobile app only explains that. */
export default function DoctorPortal(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const signOut = useAuthStore((state) => state.signOut);

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <Logo size="md" />
      <EmptyState icon="monitor" title={t('doctor.portal.title')} message={t('doctor.portal.body')} />
      <Button
        variant="secondary"
        icon="log-out"
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
