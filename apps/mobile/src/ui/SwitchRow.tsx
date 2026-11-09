import { Pressable, Switch, View } from 'react-native';
import { createStyles, layout, space, useTheme } from '../theme/theme';
import { useFocusRing } from './focus';
import { Text } from './Text';

/** Whole row toggles (≥ 48dp), announced as a switch with its label. */
export function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, ring.focused && styles.focused]}
    >
      <View style={styles.label}>
        <Text>{label}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        thumbColor={colors.surface}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.touchTarget + 8,
    paddingHorizontal: space[1],
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  label: { flex: 1 },
  pressed: { backgroundColor: c.surfaceMuted },
  focused: { borderColor: c.focus },
}));
