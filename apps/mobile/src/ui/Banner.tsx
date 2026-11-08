import { Linking, Pressable, View } from 'react-native';
import { useT } from '../i18n';
import { fontFamily } from '../theme/fonts';
import { createStyles, layout, radius, space, useTheme, type ThemeColors } from '../theme/theme';
import { useFocusRing } from './focus';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<BannerTone, { bg: keyof ThemeColors; border: keyof ThemeColors; fg: keyof ThemeColors; icon: IconName }> = {
  info: { bg: 'infoBg', border: 'infoBorder', fg: 'infoFg', icon: 'info' },
  success: { bg: 'successBg', border: 'successBorder', fg: 'successFg', icon: 'check-circle' },
  warning: { bg: 'warningBg', border: 'warningBorder', fg: 'warningFg', icon: 'alert-triangle' },
  danger: { bg: 'dangerBg', border: 'dangerBorder', fg: 'dangerFg', icon: 'alert-circle' },
};

/** Inline message. Emergency is NOT a tone here — use EmergencyStrip / EmergencyCallCard. */
export function Banner({
  tone = 'info',
  title,
  message,
  icon,
  action,
}: {
  tone?: BannerTone;
  title?: string;
  message: string;
  icon?: IconName;
  action?: { label: string; onPress: () => void };
}): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const spec = TONE[tone];
  const fg = colors[spec.fg];
  return (
    <View
      style={[styles.banner, { backgroundColor: colors[spec.bg], borderColor: colors[spec.border] }]}
      accessibilityRole={tone === 'danger' || tone === 'warning' ? 'alert' : 'summary'}
    >
      <Icon name={icon ?? spec.icon} size={22} color={fg} />
      <View style={styles.copy}>
        {title !== undefined ? (
          <Text variant="bodyStrong" style={{ color: fg }}>
            {title}
          </Text>
        ) : null}
        <Text style={{ color: tone === 'info' || tone === 'success' ? colors.text : fg }}>{message}</Text>
        {action !== undefined ? <BannerAction label={action.label} onPress={action.onPress} color={fg} /> : null}
      </View>
    </View>
  );
}

function BannerAction({ label, onPress, color }: { label: string; onPress: () => void; color: string }): React.JSX.Element {
  const styles = useStyles();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed, ring.focused && styles.focused]}
    >
      <Text variant="label" style={[styles.actionLabel, { color }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function dial(number: '112' | '115'): void {
  void Linking.openURL(`tel:${number}`).catch(() => undefined);
}

/**
 * The always-visible top strip (auth + patient shells): "Dharura?" and two
 * white call buttons. Each opens the phone dialer with 112 / 115 filled in
 * (tel: — the user still presses call). Solid emergency red in every theme.
 */
export function EmergencyStrip(): React.JSX.Element {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.strip}>
      <View style={styles.stripLabel}>
        <Icon name="alert-triangle" size={18} color={styles.stripText.color} />
        <Text variant="label" style={styles.stripText}>
          {t('emergency.short')}
        </Text>
      </View>
      <View style={styles.stripButtons}>
        <StripCallButton number="112" label={t('emergency.call112')} accessibilityLabel={t('emergency.call112.a11y')} />
        <StripCallButton number="115" label={t('emergency.call115.short')} accessibilityLabel={t('emergency.call115')} />
      </View>
    </View>
  );
}

function StripCallButton({
  number,
  label,
  accessibilityLabel,
}: {
  number: '112' | '115';
  label: string;
  accessibilityLabel: string;
}): React.JSX.Element {
  const styles = useStyles();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => dial(number)}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      hitSlop={{ top: 4, bottom: 4 }}
      style={({ pressed }) => [styles.stripButton, pressed && styles.callButtonPressed, ring.focused && styles.callFocused]}
    >
      <Icon name="phone" size={16} color={styles.callLabel.color} />
      <Text variant="label" style={styles.stripButtonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Large emergency block (screening red flags, emergency screen): two call buttons. */
export function EmergencyCallCard({ message }: { message?: string }): React.JSX.Element {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={styles.emergencyCard} accessibilityRole="alert">
      <View style={styles.emergencyHead}>
        <Icon name="alert-triangle" size={28} color={styles.stripText.color} />
        <Text variant="heading" tone="onEmergency" style={styles.copy}>
          {message ?? t('emergency.line')}
        </Text>
      </View>
      <EmergencyCallButton number="112" label={t('emergency.call112')} />
      <EmergencyCallButton number="115" label={t('emergency.call115')} />
    </View>
  );
}

function EmergencyCallButton({ number, label }: { number: '112' | '115'; label: string }): React.JSX.Element {
  const styles = useStyles();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => dial(number)}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      style={({ pressed }) => [styles.callButton, pressed && styles.callButtonPressed, ring.focused && styles.callFocused]}
    >
      <Icon name="phone" size={20} color={styles.callLabel.color} />
      <Text variant="button" style={styles.callLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  copy: { flex: 1, gap: space[1] },
  action: {
    alignSelf: 'flex-start',
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    marginLeft: -space[2],
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  actionPressed: { backgroundColor: 'rgba(0,0,0,0.06)' },
  actionLabel: { textDecorationLine: 'underline' },
  focused: { borderColor: c.focus },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space[3],
    rowGap: space[1],
    paddingVertical: space[1] + 2,
    paddingHorizontal: space[4],
    backgroundColor: c.emergencyBg,
  },
  stripLabel: { flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, flexShrink: 1 },
  stripText: { color: c.onEmergency, fontFamily: fontFamily.bold, flexShrink: 1 },
  stripButtons: { flexDirection: 'row', gap: space[2], marginLeft: 'auto' },
  stripButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 44,
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    backgroundColor: c.onEmergency,
    borderWidth: 2,
    borderColor: c.onEmergency,
  },
  stripButtonLabel: { color: c.emergencyBg, fontFamily: fontFamily.bold },
  emergencyCard: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: c.emergencyBg,
  },
  emergencyHead: { flexDirection: 'row', gap: space[3], alignItems: 'center' },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    minHeight: 52,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    backgroundColor: c.onEmergency,
    borderWidth: 2,
    borderColor: c.onEmergency,
  },
  callButtonPressed: { backgroundColor: c.dangerBg },
  callFocused: { borderColor: c.focus },
  callLabel: { color: c.emergencyBg, flexShrink: 1, textAlign: 'center' },
}));
