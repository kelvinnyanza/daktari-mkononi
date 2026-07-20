import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Body, Button, LinkButton, Screen, TextField, Title } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { authApi } from '../../src/services/endpoints';

/** Matches the server's forgot-password rate limit (3/hour → generous gap). */
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyOtp(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string; purpose?: string }>();
  const purpose = params.purpose === 'PASSWORD_RESET' ? 'PASSWORD_RESET' : 'PHONE_VERIFY';
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const submit = async (): Promise<void> => {
    if (!/^\d{6}$/.test(code)) {
      setFormError(t('error.INVALID_OTP'));
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      await authApi.verifyOtp({ phone: params.phone ?? '', purpose, code });
      setNotice(t('auth.otp.success'));
      router.replace('/(auth)/login');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    try {
      if (purpose === 'PHONE_VERIFY') {
        // Registration re-send (Phase 9): dedicated anti-enumeration endpoint
        // that replaces the previous code (single active code per purpose).
        await authApi.resendOtp({ phoneNumber: params.phone ?? '' });
        setNotice(t('auth.register.sent'));
      } else {
        // Password resets keep their own resend path.
        await authApi.forgotPassword({ phone: params.phone ?? '' });
        setNotice(t('auth.forgot.sent'));
      }
    } catch (error) {
      setFormError(errorMessage(error));
    }
  };

  return (
    <Screen>
      <Title>{t('auth.otp.title')}</Title>
      <Body muted>{t('auth.otp.instruction')}</Body>
      <TextField
        label={t('auth.reset.code')}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        error={undefined}
      />
      {notice !== null ? <Body muted>{notice}</Body> : null}
      {formError !== null ? <Body>{formError}</Body> : null}
      <Button label={t('auth.otp.submit')} onPress={() => void submit()} disabled={busy} />
      {cooldown > 0 ? (
        <Body muted>{t('auth.otp.resendWait', { seconds: cooldown })}</Body>
      ) : (
        <LinkButton label={t('auth.otp.resend')} onPress={() => void resend()} />
      )}
    </Screen>
  );
}
