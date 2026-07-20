import { patientRegistrationSchema } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Body, Button, ChipRow, LinkButton, Screen, TextField, Title } from '../../src/components/ui';
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
    <Screen>
      <Title>{t('auth.register.title')}</Title>
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
      <TextField
        label={t('auth.register.fullName')}
        value={fullName}
        onChangeText={setFullName}
        error={fieldErrors.fullName}
      />
      <TextField
        label={t('auth.register.dob')}
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
        placeholder="1995-06-15"
        autoCapitalize="none"
        error={fieldErrors.dateOfBirth}
      />
      <Body muted>{t('auth.register.gender')}</Body>
      <ChipRow
        options={[
          { value: 'FEMALE', label: t('auth.register.gender.female') },
          { value: 'MALE', label: t('auth.register.gender.male') },
        ]}
        value={gender}
        onChange={setGender}
      />
      {fieldErrors.gender !== undefined ? <Body>{fieldErrors.gender}</Body> : null}
      {formError !== null ? <Body>{formError}</Body> : null}
      <Button label={t('auth.register.submit')} onPress={() => void submit()} disabled={busy} />
      <LinkButton label={t('auth.register.haveAccount')} onPress={() => router.back()} />
    </Screen>
  );
}
