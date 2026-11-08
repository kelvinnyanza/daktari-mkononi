import { Pressable, View } from 'react-native';
import { createStyles, layout, radius, space, useTheme } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon } from './Icon';
import { Text } from './Text';

/** Single-select chip group (filters, gender, specialty). Wraps onto new lines. */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {options.map((option) => (
        <Chip key={option.value} label={option.label} selected={option.value === value} onPress={() => onChange(option.value)} />
      ))}
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
        ring.focused && styles.focused,
      ]}
    >
      {selected ? <Icon name="check" size={16} color={colors.onPrimarySoft} /> : null}
      <Text variant="label" style={selected ? styles.labelSelected : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: layout.touchTarget,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    backgroundColor: c.surface,
  },
  selected: { backgroundColor: c.primarySoft, borderColor: c.primary },
  pressed: { backgroundColor: c.surfaceMuted },
  focused: { borderColor: c.focus, borderWidth: 2 },
  labelSelected: { color: c.onPrimarySoft },
}));
