import { resetPasswordSchema } from '@daktari/schemas';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Banner, Button, Header, Input, PasswordInput, Screen, Stack } from '../../src/ui';
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
    <Screen header={<Header title={t('auth.reset.title')} onBack={() => router.back()} />}>
      <Stack gap={4}>
        <Input
          label={t('auth.reset.code')}
          leadingIcon="hash"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          error={fieldErrors.code}
        />
        <PasswordInput
          label={t('auth.reset.newPassword')}
          leadingIcon="lock"
          value={newPassword}
          onChangeText={setNewPassword}
          autoComplete="new-password"
          error={fieldErrors.newPassword}
        />
        {formError !== null ? <Banner tone="danger" message={formError} /> : null}
        <Button label={t('auth.reset.submit')} icon="check" onPress={() => void submit()} loading={busy} />
      </Stack>
    </Screen>
  );
}
