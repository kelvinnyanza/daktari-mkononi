import type { PropsWithChildren } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { createStyles, elevation, radius, space } from '../theme/theme';
import { useFocusRing } from './focus';

export interface CardProps {
  /** Makes the whole card one tap target (e.g. an appointment summary). */
  onPress?: () => void;
  /** Required with onPress: what TalkBack announces for the card. */
  accessibilityLabel?: string;
  tone?: 'default' | 'muted' | 'primary';
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** White surface, hairline border, soft shadow. Content decides its height. */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  tone = 'default',
  padded = true,
  style,
}: PropsWithChildren<CardProps>): React.JSX.Element {
  const styles = useStyles();
  const ring = useFocusRing();
  const base = [styles.card, styles[tone], padded && styles.padded, style];
  if (onPress === undefined) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [...base, pressed && styles.pressed, ring.focused && styles.focused]}
    >
      {children}
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    gap: space[3],
    ...elevation.sm,
  },
  default: { backgroundColor: c.surface },
  muted: { backgroundColor: c.surfaceMuted, borderColor: c.surfaceMuted, elevation: 0, shadowOpacity: 0 },
  primary: { backgroundColor: c.primarySoft, borderColor: c.primarySoft, elevation: 0, shadowOpacity: 0 },
  padded: { padding: space[4] },
  pressed: { backgroundColor: c.surfaceMuted },
  focused: { borderColor: c.focus, borderWidth: 2 },
}));
