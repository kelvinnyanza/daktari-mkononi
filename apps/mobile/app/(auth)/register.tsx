import { patientRegistrationSchema } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AuthLayout } from '../../src/components/auth-layout';
import { useI18nStore, useT, type Locale } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm } from '../../src/lib/form';
import { toE164 } from '../../src/lib/phone';
import { authApi } from '../../src/services/endpoints';
import { space } from '../../src/theme/theme';
import {
  Banner,
  Button,
  Checkbox,
  ChipGroup,
  Input,
  PasswordInput,
  PasswordStrength,
  PhoneInput,
  Text,
} from '../../src/ui';

type Field = 'fullName' | 'phone' | 'password' | 'consent';

/**
 * Registration (UI Phase 2): name, phone, password (live strength hint),
 * language, and one consent box (18+, Terms, Privacy). Date of birth and sex
 * moved to the health profile after OTP. The API call and the OTP flow are
 * unchanged: register → verify-otp (PHONE_VERIFY) → login.
 */
export default function Register(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { locale, setLocale } = useI18nStore();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const clear = (field: Field): void =>
    setErrors((current) => {
      if (current[field] === undefined) return current;
      const { [field]: _cleared, ...rest } = current;
      return rest;
    });

  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'));

  const submit = async (): Promise<void> => {
    setFormError(null);
    // Same Zod schema the server validates with; the messages shown are ours.
    const validated = validateForm(patientRegistrationSchema, {
      phone: toE164(phone),
      password,
      fullName,
      language: locale,
    });
    const next: Partial<Record<Field, string>> = {};
    if (!validated.ok) {
      if (validated.fieldErrors.fullName !== undefined) next.fullName = t('auth.fullName.invalid');
      if (validated.fieldErrors.phone !== undefined) {
        next.phone = phone === '' ? t('auth.phone.required') : t('auth.phone.invalid');
      }
      if (validated.fieldErrors.password !== undefined) next.password = t('auth.password.invalid');
    }
    if (!consent) next.consent = t('auth.consent.required');
    setErrors(next);
    if (!validated.ok || !consent) return;

    setBusy(true);
    try {
      await authApi.register({
        phone: validated.data.phone,
        password,
        fullName: validated.data.fullName,
        language: locale,
      });
      // Anti-enumeration: the same generic message either way; proceed to OTP.
      router.push({
        pathname: '/(auth)/verify-otp',
        params: { phone: validated.data.phone, purpose: 'PHONE_VERIFY' },
      });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.register.welcome')}
      subtitle={t('auth.register.welcomeBody')}
      onBack={back}
      backLabel={t('auth.register.title')}
      after={<Button variant="ghost" label={t('auth.register.haveAccount')} onPress={() => router.replace('/(auth)/login')} />}
    >
      <View style={{ gap: space[2] }}>
        <Text variant="label">{t('auth.register.language')}</Text>
        <ChipGroup<Locale>
          options={[
            { value: 'sw', label: t('profile.language.sw') },
            { value: 'en', label: t('profile.language.en') },
          ]}
          value={locale}
          onChange={setLocale} // the form switches language immediately
        />
      </View>
      <Input
        label={t('auth.register.fullName')}
        leadingIcon="user"
        value={fullName}
        onChangeText={(text) => {
          setFullName(text);
          clear('fullName');
        }}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        hint={t('auth.fullName.hint')}
        error={errors.fullName}
        testID="register-name"
      />
      <PhoneInput label={t('auth.login.phone')} value={phone}
        onChangeDigits={(digits) => {
          setPhone(digits);
          clear('phone');
        }}
        error={errors.phone}
        testID="register-phone" />
      <View style={{ gap: space[2] }}>
        <PasswordInput
          label={t('auth.login.password')}
          leadingIcon="lock"
          value={password}
          onChangeText={(text) => {
            setPassword(text);
            clear('password');
          }}
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.password}
          testID="register-password"
        />
        <PasswordStrength password={password} />
      </View>
      <Checkbox
        checked={consent}
        onChange={(value) => {
          setConsent(value);
          clear('consent');
        }}
        label={t('auth.consent.label')}
        error={errors.consent}
        testID="register-consent"
        below={
          <>
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              icon="file-text"
              label={t('auth.consent.terms')}
              onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
            />
            <Button
              variant="ghost"
              size="sm"
              fullWidth={false}
              icon="shield"
              label={t('auth.consent.privacy')}
              onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
            />
          </>
        }
      />
      {formError !== null ? <Banner tone="danger" message={formError} /> : null}
      <Button label={t('auth.register.submit')} icon="user-plus" onPress={() => void submit()} loading={busy} testID="register-submit" />
    </AuthLayout>
  );
}
