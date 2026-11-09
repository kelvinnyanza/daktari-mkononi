import { Pressable, ScrollView, View } from 'react-native';
import { createStyles, layout, radius, space, useTheme } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon } from './Icon';
import { Text } from './Text';

/**
 * Single-select chip group (filters, gender, specialty). Wraps onto new lines,
 * or with `scroll` stays one horizontally scrolling line (long option lists).
 */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  scroll = false,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  scroll?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  const chips = options.map((option) => (
    <Chip key={option.value} label={option.label} selected={option.value === value} onPress={() => onChange(option.value)} />
  ));
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        contentContainerStyle={styles.scrollRow}
      >
        {chips}
      </ScrollView>
    );
  }
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {chips}
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
      <Text variant="label" style={[styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  scrollRow: { flexDirection: 'row', gap: space[2], paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: layout.touchTarget,
    maxWidth: '100%',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    backgroundColor: c.surface,
  },
  selected: { backgroundColor: c.primarySoft, borderColor: c.primary },
  pressed: { backgroundColor: c.surfaceMuted },
  focused: { borderColor: c.focus, borderWidth: 2 },
  label: { flexShrink: 1 },
  labelSelected: { color: c.onPrimarySoft },
}));
