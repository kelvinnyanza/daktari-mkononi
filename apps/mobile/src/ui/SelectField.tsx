import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { createStyles, layout, radius, space, useTheme } from '../theme/theme';
import { BottomSheet } from './BottomSheet';
import { useFocusRing } from './focus';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * Single choice from a long list (31 regions): looks like an Input (label
 * above, same box), opens a BottomSheet list with the current choice ticked.
 * Short lists stay ChipGroups.
 */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  leadingIcon,
  error,
  hint,
  testID,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  placeholder: string;
  leadingIcon?: IconName;
  error?: string | undefined;
  hint?: string;
  testID?: string;
}): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const hasError = error !== undefined;

  return (
    <View style={styles.field}>
      <Text variant="label">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityHint={error ?? hint}
        onPress={() => setOpen(true)}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        testID={testID}
        style={({ pressed }) => [
          styles.box,
          hasError || ring.focused ? styles.boxThick : styles.boxThin,
          ring.focused && styles.boxFocused,
          hasError && styles.boxError,
          pressed && styles.pressed,
        ]}
      >
        {leadingIcon !== undefined ? <Icon name={leadingIcon} size={20} color={colors.textSecondary} /> : null}
        <Text style={styles.value} tone={selected === undefined ? 'secondary' : 'default'}>
          {selected?.label ?? placeholder}
        </Text>
        <Icon name="chevron-down" size={20} color={colors.textSecondary} />
      </Pressable>
      {hasError ? (
        <View style={styles.messageRow} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={16} color={colors.dangerFg} />
          <Text variant="caption" tone="danger" style={styles.value}>
            {error}
          </Text>
        </View>
      ) : hint !== undefined ? (
        <Text variant="caption" tone="secondary">
          {hint}
        </Text>
      ) : null}

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={styles.list} accessibilityRole="radiogroup">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.option, isSelected && styles.optionSelected, pressed && styles.pressed]}
              >
                <Text variant={isSelected ? 'bodyStrong' : 'body'} style={styles.value}>
                  {option.label}
                </Text>
                {isSelected ? <Icon name="check" size={20} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </View>
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
    paddingVertical: space[3],
  },
  boxThin: { borderWidth: 1.5, paddingHorizontal: space[3] + 0.5 },
  boxThick: { borderWidth: 2, paddingHorizontal: space[3] },
  boxFocused: { borderColor: c.primary },
  boxError: { borderColor: c.dangerFg },
  pressed: { backgroundColor: c.primarySoft },
  value: { flex: 1 },
  messageRow: { flexDirection: 'row', gap: space[1], alignItems: 'flex-start' },
  list: { maxHeight: 420 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.touchTarget,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  optionSelected: { backgroundColor: c.primarySoft },
}));
