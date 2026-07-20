import { loginSchema } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Body, Button, LinkButton, Screen, TextField, Title, EmergencyBanner } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm, type FieldErrors } from '../../src/lib/form';
import { ApiError, adoptTokenPair } from '../../src/services/api';
import { authApi } from '../../src/services/endpoints';
import { useAuthStore, type Role } from '../../src/stores/auth';

export default function Login(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const signIn = useAuthStore((state) => state.signIn);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setFormError(null);
    const validated = validateForm(loginSchema, { phone, password });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await authApi.login(validated.data);
      if (result.status === '2FA_REQUIRED') {
        router.push('/(auth)/two-factor');
        return;
      }
      await adoptTokenPair({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      const user = result.user;
      signIn(user?.id ?? '', (user?.role as Role | undefined) ?? 'PATIENT');
      router.replace('/');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'PHONE_NOT_VERIFIED') {
        // 403 → straight to OTP verification for this phone.
        router.push({
          pathname: '/(auth)/verify-otp',
          params: { phone: validated.data.phone, purpose: 'PHONE_VERIFY' },
        });
        return;
      }
      setFormError(errorMessage(error)); // INVALID_CREDENTIALS / ACCOUNT_LOCKED / …
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <EmergencyBanner />
      <Title>{t('auth.login.title')}</Title>
      <TextField
        label={t('auth.login.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
        error={fieldErrors.phone}
      />
      <TextField
        label={t('auth.login.password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        error={fieldErrors.password}
      />
      {formError !== null ? <Body>{formError}</Body> : null}
      <Button label={t('auth.login.submit')} onPress={() => void submit()} disabled={busy} />
      <LinkButton label={t('auth.login.noAccount')} onPress={() => router.push('/(auth)/register')} />
      <LinkButton label={t('auth.login.forgot')} onPress={() => router.push('/(auth)/forgot-password')} />
    </Screen>
  );
}
