import type { AppointmentStatus, PaymentStatusValue } from '@daktari/schemas';
import { View } from 'react-native';
import { useT } from '../i18n';
import { fontFamily } from '../theme/fonts';
import { createStyles, radius, space, useTheme, type ThemeColors } from '../theme/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, { bg: keyof ThemeColors; fg: keyof ThemeColors; border: keyof ThemeColors }> = {
  neutral: { bg: 'neutralBg', fg: 'neutralFg', border: 'neutralBorder' },
  primary: { bg: 'primarySoft', fg: 'onPrimarySoft', border: 'primarySoft' },
  success: { bg: 'successBg', fg: 'successFg', border: 'successBorder' },
  warning: { bg: 'warningBg', fg: 'warningFg', border: 'warningBorder' },
  danger: { bg: 'dangerBg', fg: 'dangerFg', border: 'dangerBorder' },
  info: { bg: 'infoBg', fg: 'infoFg', border: 'infoBorder' },
};

/** Small label with icon + text — status is never conveyed by colour alone. */
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: BadgeTone; icon?: IconName }): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: colors[t.bg], borderColor: colors[t.border] }]}>
      {icon !== undefined ? <Icon name={icon} size={14} color={colors[t.fg]} /> : null}
      <Text variant="caption" style={[styles.label, { color: colors[t.fg] }]}>
        {label}
      </Text>
    </View>
  );
}

/** Single mapping for appointment status → tone + icon, used on every screen. */
export const APPOINTMENT_STATUS_STYLE: Record<AppointmentStatus, { tone: BadgeTone; icon: IconName }> = {
  PENDING_PAYMENT: { tone: 'warning', icon: 'clock' },
  CONFIRMED: { tone: 'info', icon: 'check' },
  CHECKED_IN: { tone: 'info', icon: 'log-in' },
  IN_PROGRESS: { tone: 'primary', icon: 'video' },
  COMPLETED: { tone: 'success', icon: 'check-circle' },
  CANCELLED: { tone: 'neutral', icon: 'x-circle' },
  NO_SHOW: { tone: 'danger', icon: 'slash' },
};

export const PAYMENT_STATUS_STYLE: Record<PaymentStatusValue, { tone: BadgeTone; icon: IconName }> = {
  PENDING: { tone: 'warning', icon: 'clock' },
  PROCESSING: { tone: 'info', icon: 'loader' },
  COMPLETED: { tone: 'success', icon: 'check-circle' },
  FAILED: { tone: 'danger', icon: 'alert-circle' },
  REFUNDED: { tone: 'neutral', icon: 'rotate-ccw' },
};

export function AppointmentStatusPill({ status }: { status: AppointmentStatus }): React.JSX.Element {
  const t = useT();
  const style = APPOINTMENT_STATUS_STYLE[status];
  return <Badge label={t(`appointments.status.${status}`)} tone={style.tone} icon={style.icon} />;
}

export function PaymentStatusPill({ status }: { status: PaymentStatusValue }): React.JSX.Element {
  const t = useT();
  const style = PAYMENT_STATUS_STYLE[status];
  return <Badge label={t(`payment.status.${status}`)} tone={style.tone} icon={style.icon} />;
}

const useStyles = createStyles(() => ({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space[2] + 2,
    paddingVertical: 2,
    maxWidth: '100%',
  },
  label: { fontFamily: fontFamily.semibold, flexShrink: 1 },
}));
