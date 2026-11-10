import { loginSchema } from '@daktari/schemas';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useT } from '../../src/i18n';
import { AuthLayout } from '../../src/components/auth-layout';
import { DevStylePreviewEntry } from '../../src/components/dev-style-preview-entry';
import { errorMessage } from '../../src/lib/errors';
import { validateForm } from '../../src/lib/form';
import { fromE164, toE164 } from '../../src/lib/phone';
import { ApiError, adoptTokenPair } from '../../src/services/api';
import { authApi, patientApi } from '../../src/services/endpoints';
import { useAuthStore, type Role } from '../../src/stores/auth';
import { Banner, Button, PasswordInput, PhoneInput } from '../../src/ui';

/** Already filled (e.g. a re-verified account)? Unknown → treat as done: never block Home. */
async function healthProfileDone(): Promise<boolean> {
  try {
    return (await patientApi.myProfile()).healthProfileCompleted;
  } catch {
    return true;
  }
}

export default function Login(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  // After registration + OTP the phone is carried over and the patient goes
  // on to the health profile ("Tukufahamu zaidi") before Home.
  const params = useLocalSearchParams<{ phone?: string; next?: string }>();
  const signIn = useAuthStore((state) => state.signIn);
  const [phone, setPhone] = useState(() => fromE164(params.phone));
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setFormError(null);
    // Same Zod schema the server validates with; messages are ours (sw/en).
    const validated = validateForm(loginSchema, { phone: toE164(phone), password });
    if (!validated.ok) {
      setErrors({
        ...(validated.fieldErrors.phone !== undefined
          ? { phone: phone === '' ? t('auth.phone.required') : t('auth.phone.invalid') }
          : {}),
        ...(validated.fieldErrors.password !== undefined ? { password: t('auth.password.required') } : {}),
      });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await authApi.login(validated.data);
      if (result.status === '2FA_REQUIRED') {
        router.push('/(auth)/two-factor');
        return;
      }
      await adoptTokenPair({ accessToken: result.accessToken, refreshToken: result.refreshToken });
      const user = result.user;
      const role = (user?.role as Role | undefined) ?? 'PATIENT';
      signIn(user?.id ?? '', role);
      if (params.next === 'health-profile' && role === 'PATIENT' && !(await healthProfileDone())) {
        router.replace({ pathname: '/(patient)/health-profile', params: { onboarding: '1' } });
      } else {
        router.replace('/');
      }
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
    <AuthLayout
      title={t('auth.login.welcome')}
      subtitle={t('auth.login.welcomeBody')}
      after={
        <>
          <Button variant="secondary" label={t('auth.login.noAccount')} onPress={() => router.push('/(auth)/register')} />
          <DevStylePreviewEntry />
        </>
      }
    >
      <PhoneInput label={t('auth.login.phone')} value={phone}
        onChangeDigits={(digits) => {
          setPhone(digits);
          setErrors(({ phone: _cleared, ...rest }) => rest);
        }}
        error={errors.phone}
        testID="login-phone" />
      <PasswordInput
        label={t('auth.login.password')}
        leadingIcon="lock"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          setErrors(({ password: _cleared, ...rest }) => rest);
        }}
        autoComplete="current-password"
        error={errors.password}
        onSubmitEditing={() => void submit()}
        testID="login-password"
      />
      {formError !== null ? <Banner tone="danger" message={formError} /> : null}
      <Button label={t('auth.login.submit')} icon="log-in" onPress={() => void submit()} loading={busy} testID="login-submit" />
      <Button variant="ghost" label={t('auth.login.forgot')} onPress={() => router.push('/(auth)/forgot-password')} />
    </AuthLayout>
  );
}
