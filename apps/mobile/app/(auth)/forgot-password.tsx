import { forgotPasswordSchema } from '@daktari/schemas';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Button, Header, Input, Screen, Stack, Text } from '../../src/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm, type FieldErrors } from '../../src/lib/form';
import { authApi } from '../../src/services/endpoints';

export default function ForgotPassword(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  // Prefilled when opened from Profile → Faragha na usalama → Badilisha nenosiri.
  const params = useLocalSearchParams<{ phone?: string }>();
  const [phone, setPhone] = useState(params.phone ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setFormError(null);
    const validated = validateForm(forgotPasswordSchema, { phone });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await authApi.forgotPassword(validated.data);
      // Anti-enumeration: same generic message whether the account exists.
      router.push({ pathname: '/(auth)/reset-password', params: { phone: validated.data.phone } });
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header title={t('auth.forgot.title')} onBack={() => router.back()} />}>
      <Stack gap={4}>
        <Text tone="secondary">{t('auth.forgot.instruction')}</Text>
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
        {formError !== null ? <Banner tone="danger" message={formError} /> : null}
        <Button label={t('auth.forgot.submit')} icon="send" onPress={() => void submit()} loading={busy} />
      </Stack>
    </Screen>
  );
}
