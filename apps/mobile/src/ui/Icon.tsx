import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { layout, useTheme } from '../theme/theme';

/**
 * Feather line icons (MIT) — one 56 KB font already supported by the native
 * build (expo-font), consistent 2px strokes that match the calm style.
 */
export type IconName = ComponentProps<typeof Feather>['name'];

/** Decorative by default: hidden from screen readers. Meaning must also be in text or an accessibilityLabel. */
export function Icon({
  name,
  size = layout.iconSize,
  color,
}: {
  name: IconName;
  size?: number;
  color?: string;
}): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <Feather
      name={name}
      size={size}
      color={color ?? colors.text}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
