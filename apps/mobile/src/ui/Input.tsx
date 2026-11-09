import { useState, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { createStyles, layout, radius, space, type, useTheme } from '../theme/theme';
import { useT } from '../i18n';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { noWebOutline } from './web-outline';

export interface InputProps extends Omit<TextInputProps, 'style' | 'editable'> {
  label: string;
  /** Helper shown under the field (format, why we ask). */
  hint?: string | undefined;
  /** Replaces the hint, turns the border red, announced politely. */
  error?: string | undefined;
  leadingIcon?: IconName;
  /** Small trailing control inside the field (e.g. show-password IconButton). */
  trailing?: ReactNode;
  disabled?: boolean;
}

/**
 * Label is always visible above the field (never placeholder-only — the
 * placeholder disappears as soon as someone types). Border is 1.5dp at rest,
 * 2dp focused/errored, with padding compensating so nothing shifts.
 */
export function Input({
  label,
  hint,
  error,
  leadingIcon,
  trailing,
  disabled = false,
  onFocus,
  onBlur,
  ...inputProps
}: InputProps): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const hasError = error !== undefined;
  const thick = focused || hasError;

  return (
    <View style={styles.field}>
      <Text variant="label" tone={disabled ? 'disabled' : 'default'}>
        {label}
      </Text>
      <View
        style={[
          styles.box,
          thick ? styles.boxThick : styles.boxThin,
          focused && styles.boxFocused,
          hasError && styles.boxError,
          disabled && styles.boxDisabled,
        ]}
      >
        {leadingIcon !== undefined ? (
          <Icon name={leadingIcon} size={20} color={disabled ? colors.textDisabled : colors.textSecondary} />
        ) : null}
        <TextInput
          style={styles.input}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          editable={!disabled}
          accessibilityState={{ disabled }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...inputProps}
        />
        {trailing}
      </View>
      {hasError ? (
        <View style={styles.messageRow} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={16} color={colors.dangerFg} />
          <Text variant="caption" tone="danger" style={styles.message}>
            {error}
          </Text>
        </View>
      ) : hint !== undefined ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Password field with a 48dp show/hide toggle ("Onyesha nenosiri" / "Show password"). */
export function PasswordInput(props: Omit<InputProps, 'secureTextEntry' | 'trailing'>): React.JSX.Element {
  const t = useT();
  const [visible, setVisible] = useState(false);
  return (
    <Input
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      trailing={
        <IconButton
          icon={visible ? 'eye-off' : 'eye'}
          accessibilityLabel={visible ? t('a11y.hidePassword') : t('a11y.showPassword')}
          onPress={() => setVisible((value) => !value)}
        />
      }
    />
  );
}

const useStyles = createStyles((c) => ({
  field: { gap: space[1] + 2 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.touchTarget + 4,
    borderRadius: radius.md,
    borderColor: c.borderStrong,
    backgroundColor: c.surface,
  },
  boxThin: { borderWidth: 1.5, paddingHorizontal: space[3] + 0.5 },
  boxThick: { borderWidth: 2, paddingHorizontal: space[3] },
  boxFocused: { borderColor: c.primary },
  boxError: { borderColor: c.dangerFg },
  boxDisabled: { backgroundColor: c.disabledFill, borderColor: c.border },
  input: {
    flex: 1,
    ...type.body,
    color: c.text,
    paddingVertical: space[3],
    // Web preview only: the field's own border is the focus indicator.
    ...noWebOutline,
  },
  messageRow: { flexDirection: 'row', gap: space[1], alignItems: 'flex-start' },
  message: { flexShrink: 1 },
}));
