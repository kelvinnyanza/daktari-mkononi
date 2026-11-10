import { useT } from '../i18n';
import { formatLocal, localDigits } from '../lib/phone';
import { Input } from './Input';

/**
 * Tanzanian phone field: a fixed "+255" prefix, the patient types the 9 local
 * digits (shown as "712 345 678"). Leading 0 / 255 / +255 in typed or pasted
 * text is dropped. `value` / `onChangeDigits` carry the bare digits; turn them
 * into the API form with toE164() (src/lib/phone.ts).
 */
export function PhoneInput({
  label,
  value,
  onChangeDigits,
  error,
  hint,
  testID,
}: {
  label: string;
  value: string;
  onChangeDigits: (digits: string) => void;
  error?: string | undefined;
  hint?: string;
  testID?: string;
}): React.JSX.Element {
  const t = useT();
  return (
    <Input
      label={label}
      leadingIcon="phone"
      prefix="+255"
      value={formatLocal(value)}
      onChangeText={(text) => onChangeDigits(localDigits(text))}
      keyboardType="phone-pad"
      autoCapitalize="none"
      autoComplete="tel"
      textContentType="telephoneNumber"
      placeholder="712 345 678"
      hint={hint ?? t('auth.phone.hint')}
      error={error}
      accessibilityLabel={`${label}, +255`}
      {...(testID !== undefined ? { testID } : {})}
    />
  );
}
