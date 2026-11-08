import { loginSchema } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { space } from '../../src/theme/theme';
import { Banner, Button, Input, Logo, PasswordInput, Screen, Stack, Text } from '../../src/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm, type FieldErrors } from '../../src/lib/form';
import { ApiError, adoptTokenPair } from '../../src/services/api';
import { authApi } from '../../src/services/endpoints';
import { useAuthStore, type Role } from '../../src/stores/auth';
import { DevStylePreviewEntry } from '../../src/components/dev-style-preview-entry';

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
      <View style={{ alignItems: 'center', paddingTop: space[6] }}>
        <Logo size="lg" stacked tagline />
      </View>
      <Stack gap={4}>
        <Text variant="title" accessibilityRole="header">
          {t('auth.login.title')}
        </Text>
        <Input
          label={t('auth.login.phone')}
          leadingIcon="phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          autoCapitalize="none"
          autoComplete="tel"
          placeholder="0712 345 678"
          error={fieldErrors.phone}
        />
        <PasswordInput
          label={t('auth.login.password')}
          leadingIcon="lock"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          error={fieldErrors.password}
        />
        {formError !== null ? <Banner tone="danger" message={formError} /> : null}
        <Button label={t('auth.login.submit')} icon="log-in" onPress={() => void submit()} loading={busy} />
        <Button variant="ghost" label={t('auth.login.forgot')} onPress={() => router.push('/(auth)/forgot-password')} />
      </Stack>
      <Button variant="secondary" label={t('auth.login.noAccount')} onPress={() => router.push('/(auth)/register')} />
      <DevStylePreviewEntry />
    </Screen>
  );
}
