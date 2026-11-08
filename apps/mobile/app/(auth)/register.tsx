import { patientRegistrationSchema } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Button, ChipGroup, Header, Input, PasswordInput, Screen, Stack, Text } from '../../src/ui';
import { useI18nStore, useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm, type FieldErrors } from '../../src/lib/form';
import { authApi } from '../../src/services/endpoints';

export default function Register(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const locale = useI18nStore((state) => state.locale);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setFormError(null);
    // Same Zod schema the server validates with — one source of truth.
    const validated = validateForm(patientRegistrationSchema, {
      phone,
      password,
      fullName,
      dateOfBirth,
      gender,
      language: locale,
    });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await authApi.register({
        phone: validated.data.phone,
        password,
        fullName: validated.data.fullName,
        dateOfBirth,
        gender: validated.data.gender,
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
    <Screen header={<Header title={t('auth.register.title')} onBack={() => router.back()} />}>
      <Stack gap={4}>
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
          autoComplete="new-password"
          error={fieldErrors.password}
        />
        <Input
          label={t('auth.register.fullName')}
          leadingIcon="user"
          value={fullName}
          onChangeText={setFullName}
          autoComplete="name"
          error={fieldErrors.fullName}
        />
        <Input
          label={t('auth.register.dob')}
          leadingIcon="calendar"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          placeholder="1995-06-15"
          autoCapitalize="none"
          error={fieldErrors.dateOfBirth}
        />
        <Stack gap={2}>
          <Text variant="label">{t('auth.register.gender')}</Text>
          <ChipGroup
            options={[
              { value: 'FEMALE', label: t('auth.register.gender.female') },
              { value: 'MALE', label: t('auth.register.gender.male') },
            ]}
            value={gender}
            onChange={setGender}
          />
          {fieldErrors.gender !== undefined ? (
            <Text variant="caption" tone="danger">
              {fieldErrors.gender}
            </Text>
          ) : null}
        </Stack>
        {formError !== null ? <Banner tone="danger" message={formError} /> : null}
        <Button label={t('auth.register.submit')} icon="user-plus" onPress={() => void submit()} loading={busy} />
        <Button variant="ghost" label={t('auth.register.haveAccount')} onPress={() => router.back()} />
      </Stack>
    </Screen>
  );
}
