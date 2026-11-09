import { ActivityIndicator, Pressable, View } from 'react-native';
import { createStyles, layout, radius, space, useTheme, type ThemeColors } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: IconName;
  /** Shows a spinner, keeps the label (no width jump), blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the container (default) — easier to hit on phones. */
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
}

function foreground(variant: ButtonVariant, colors: ThemeColors): string {
  switch (variant) {
    case 'primary':
      return colors.textOnPrimary;
    case 'danger':
      return colors.dangerFg;
    case 'secondary':
      return colors.onPrimarySoft;
    case 'ghost':
      return colors.primary;
  }
}

/**
 * One primary action per screen. `danger` is for destructive actions only
 * (cancel booking) and is OUTLINED red: solid red is reserved for 112/115
 * (EmergencyStrip / EmergencyCallCard), never a Button.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  accessibilityHint,
  testID,
}: ButtonProps): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();
  const inactive = disabled || loading;
  const fg = disabled ? colors.textDisabled : foreground(variant, colors);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        size === 'sm' ? styles.sm : styles.md,
        styles[variant],
        pressed && styles[`${variant}Pressed`],
        disabled && (variant === 'ghost' ? styles.ghostDisabled : styles.disabled),
        disabled && variant === 'danger' && styles.dangerDisabled,
        ring.focused && styles.focused,
        fullWidth ? styles.block : styles.inline,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : icon !== undefined ? (
          <Icon name={icon} size={20} color={fg} />
        ) : null}
        <Text variant={size === 'sm' ? 'label' : 'button'} style={[styles.label, { color: fg }]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  base: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'center',
  },
  md: { minHeight: 52, paddingHorizontal: space[5], paddingVertical: space[3] },
  sm: { minHeight: layout.touchTarget, paddingHorizontal: space[4], paddingVertical: space[2] },
  block: { alignSelf: 'stretch' },
  inline: { alignSelf: 'flex-start' },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  // flexShrink lets long Swahili labels wrap instead of overflowing.
  label: { textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: c.primary },
  primaryPressed: { backgroundColor: c.primaryPressed },
  secondary: { backgroundColor: c.primarySoft },
  secondaryPressed: { backgroundColor: c.primarySoftPressed },
  ghost: { backgroundColor: 'transparent' },
  ghostPressed: { backgroundColor: c.primarySoft },
  danger: { backgroundColor: c.surface, borderColor: c.dangerFg, borderWidth: 1.5 },
  dangerPressed: { backgroundColor: c.dangerBg },
  disabled: { backgroundColor: c.disabledFill },
  ghostDisabled: { backgroundColor: 'transparent' },
  dangerDisabled: { borderColor: c.border },
  focused: { borderColor: c.focus, borderWidth: 2 },
}));
