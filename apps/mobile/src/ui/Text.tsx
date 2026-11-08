import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { type ThemeColors, type TypeVariant, type, useTheme } from '../theme/theme';

export type TextTone =
  | 'default'
  | 'secondary'
  | 'disabled'
  | 'primary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'onPrimary'
  | 'onEmergency';

const TONE: Record<TextTone, keyof ThemeColors> = {
  default: 'text',
  secondary: 'textSecondary',
  disabled: 'textDisabled',
  primary: 'primary',
  success: 'successFg',
  warning: 'warningFg',
  danger: 'dangerFg',
  info: 'infoFg',
  onPrimary: 'textOnPrimary',
  onEmergency: 'onEmergency',
};

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  align?: 'auto' | 'left' | 'center' | 'right';
}

/**
 * The only text primitive screens should use. Follows the system font size
 * (no maxFontSizeMultiplier) and never truncates unless a caller passes
 * numberOfLines — Swahili strings run ~30% longer than English.
 */
export function Text({ variant = 'body', tone = 'default', align, style, ...rest }: TextProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <RNText
      style={[type[variant], { color: colors[TONE[tone]] }, align !== undefined && { textAlign: align }, style]}
      {...rest}
    />
  );
}
