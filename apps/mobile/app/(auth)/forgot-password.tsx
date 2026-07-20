import { forgotPasswordSchema } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Screen, TextField, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm, type FieldErrors } from '../../src/lib/form';
import { authApi } from '../../src/services/endpoints';

export default function ForgotPassword(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const [phone, setPhone] = useState('');
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
    <Screen>
      <Title>{t('auth.forgot.title')}</Title>
      <Body muted>{t('auth.forgot.instruction')}</Body>
      <TextField
        label={t('auth.login.phone')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoCapitalize="none"
        error={fieldErrors.phone}
      />
      {formError !== null ? <Body>{formError}</Body> : null}
      <Button label={t('auth.forgot.submit')} onPress={() => void submit()} disabled={busy} />
    </Screen>
  );
}
