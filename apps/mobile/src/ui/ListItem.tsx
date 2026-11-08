import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { createStyles, space, useTheme } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon } from './Icon';
import { Text } from './Text';

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Extra line(s) under the subtitle — pills, ratings, prices. Wraps freely. */
  meta?: ReactNode;
  leading?: ReactNode;
  /** Small trailing element (price, time). Long content belongs in `meta`. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Chevron defaults on for pressable rows. */
  showChevron?: boolean;
  accessibilityHint?: string;
  divider?: boolean;
}

/** One row: avatar/icon · text column (wraps) · trailing · chevron. ≥ 64dp tall. */
export function ListItem({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  showChevron = onPress !== undefined,
  accessibilityHint,
  divider = false,
}: ListItemProps): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const ring = useFocusRing();

  const body = (
    <>
      {leading}
      <View style={styles.text}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle !== undefined ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
        {meta !== undefined ? <View style={styles.meta}>{meta}</View> : null}
      </View>
      {trailing}
      {showChevron ? <Icon name="chevron-right" size={20} color={colors.textSecondary} /> : null}
    </>
  );

  if (onPress === undefined) {
    return <View style={[styles.row, divider && styles.divider]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [
        styles.row,
        divider && styles.divider,
        pressed && styles.pressed,
        ring.focused && styles.focused,
      ]}
    >
      {body}
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 64,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    backgroundColor: c.surface,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  divider: { borderBottomColor: c.border, borderBottomWidth: 1 },
  text: { flex: 1, gap: 2 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[1] },
  pressed: { backgroundColor: c.surfaceMuted },
  focused: { borderColor: c.focus },
}));
