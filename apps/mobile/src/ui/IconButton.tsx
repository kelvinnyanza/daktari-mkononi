import { Pressable } from 'react-native';
import { createStyles, layout, radius, useTheme } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon, type IconName } from './Icon';

/**
 * Icon-only button, 48×48dp. `accessibilityLabel` is REQUIRED — pass a t()
 * string so TalkBack reads it in the active language (sw/en).
 */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'plain',
  disabled = false,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  variant?: 'plain' | 'tonal';
  disabled?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [
        styles.base,
        variant === 'tonal' && styles.tonal,
        pressed && styles.pressed,
        ring.focused && styles.focused,
      ]}
    >
      <Icon name={icon} color={disabled ? colors.textDisabled : variant === 'tonal' ? colors.onPrimarySoft : colors.text} />
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  base: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  tonal: { backgroundColor: c.primarySoft },
  pressed: { backgroundColor: c.primarySoftPressed },
  focused: { borderColor: c.focus },
}));
