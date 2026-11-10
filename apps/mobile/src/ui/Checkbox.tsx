import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { createStyles, layout, radius, space, useTheme } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon } from './Icon';
import { Text } from './Text';

/**
 * Consent-style checkbox: the whole row (≥ 48dp) toggles; 24dp box with a 2dp
 * border (3:1 against the surface), teal fill + white check when checked. An
 * error turns the border red and is announced. Links that belong to the label
 * go in `below` (separate buttons — inline links inside a label are hard to
 * hit and invisible to TalkBack).
 */
export function Checkbox({
  checked,
  onChange,
  label,
  error,
  below,
  testID,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  error?: string | undefined;
  below?: ReactNode;
  testID?: string;
}): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();
  const hasError = error !== undefined;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={label}
        accessibilityHint={error}
        onPress={() => onChange(!checked)}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        testID={testID}
        style={({ pressed }) => [styles.row, pressed && styles.pressed, ring.focused && styles.focused]}
      >
        <View style={[styles.box, checked && styles.boxChecked, hasError && !checked && styles.boxError]}>
          {checked ? <Icon name="check" size={18} color={colors.textOnPrimary} /> : null}
        </View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {below !== undefined ? <View style={styles.below}>{below}</View> : null}
      {hasError ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={16} color={colors.dangerFg} />
          <Text variant="caption" tone="danger" style={styles.label}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((c) => ({
  wrap: { gap: space[1] },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    minHeight: layout.touchTarget,
    paddingVertical: space[2],
    paddingHorizontal: space[1],
    marginHorizontal: -space[1],
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pressed: { backgroundColor: c.primarySoft },
  focused: { borderColor: c.focus },
  box: {
    width: 24,
    height: 24,
    marginTop: 1,
    borderRadius: radius.sm - 2,
    borderWidth: 2,
    borderColor: c.borderStrong,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: { backgroundColor: c.primary, borderColor: c.primary },
  boxError: { borderColor: c.dangerFg },
  label: { flex: 1 },
  below: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1], paddingLeft: 24 + space[3] - space[2] },
  errorRow: { flexDirection: 'row', gap: space[1], alignItems: 'flex-start' },
}));
