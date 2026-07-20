import { resetPasswordSchema } from '@daktari/schemas';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Screen, TextField, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { validateForm, type FieldErrors } from '../../src/lib/form';
import { authApi } from '../../src/services/endpoints';

export default function ResetPassword(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string }>();
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    setFormError(null);
    const validated = validateForm(resetPasswordSchema, {
      phone: params.phone ?? '',
      code,
      newPassword,
    });
    if (!validated.ok) {
      setFieldErrors(validated.fieldErrors);
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      await authApi.resetPassword(validated.data);
      router.replace('/(auth)/login');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>{t('auth.reset.title')}</Title>
      <TextField
        label={t('auth.reset.code')}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        error={fieldErrors.code}
      />
      <TextField
        label={t('auth.reset.newPassword')}
        value={newPassword}
        onChangeText={setNewPassword}
        secureTextEntry
        error={fieldErrors.newPassword}
      />
      {formError !== null ? <Body>{formError}</Body> : null}
      <Button label={t('auth.reset.submit')} onPress={() => void submit()} disabled={busy} />
    </Screen>
  );
}
