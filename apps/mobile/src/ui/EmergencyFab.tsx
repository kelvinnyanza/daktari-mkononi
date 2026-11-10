import { View, Pressable } from 'react-native';
import { useT } from '../i18n';
import { fontFamily } from '../theme/fonts';
import { createStyles, elevation, radius, space } from '../theme/theme';
import { dial } from './Banner';
import { BottomSheet } from './BottomSheet';
import { useFocusRing } from './focus';
import { Icon } from './Icon';
import { Text } from './Text';

/** Height of the round button (≥ 56dp, larger than the 48dp minimum on purpose). */
export const EMERGENCY_FAB_SIZE = 60;

/**
 * Round red "Dharura" button (icon + label). Solid emergency red is reserved
 * for 112/115 — this button and the call buttons in its sheet. A white ring
 * keeps it visible on any background (including red content).
 */
export function EmergencyFab({ onPress }: { onPress: () => void }): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('emergency.fab.a11y')}
      onPress={onPress}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      testID="emergency-fab"
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed, ring.focused && styles.fabFocused]}
    >
      <Icon name="phone-call" size={24} color={styles.fabLabel.color} />
      <Text variant="button" style={styles.fabLabel}>
        {t('emergency.fab.label')}
      </Text>
    </Pressable>
  );
}

/**
 * The emergency sheet: one short safety line and two big buttons that open
 * the phone dialer with 112 / 115 filled in (tel: — never auto-calls).
 */
export function EmergencySheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element | null {
  const t = useT();
  const styles = useStyles();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('emergency.sheet.title')}>
      <View style={styles.sheet} accessibilityRole="alert">
        <Text>{t('emergency.sheet.line')}</Text>
        <DialButton number="112" label={t('emergency.call112.a11y')} />
        <DialButton number="115" label={t('emergency.call115')} />
      </View>
    </BottomSheet>
  );
}

function DialButton({ number, label }: { number: '112' | '115'; label: string }): React.JSX.Element {
  const styles = useStyles();
  const ring = useFocusRing();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => dial(number)}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      testID={`emergency-dial-${number}`}
      style={({ pressed }) => [styles.dial, pressed && styles.fabPressed, ring.focused && styles.fabFocused]}
    >
      <Icon name="phone" size={24} color={styles.fabLabel.color} />
      <View style={styles.dialText}>
        <Text style={styles.dialNumber}>{number}</Text>
        <Text variant="label" style={styles.fabLabel}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = createStyles((c) => ({
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: EMERGENCY_FAB_SIZE,
    minWidth: EMERGENCY_FAB_SIZE,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    backgroundColor: c.emergencyBg,
    borderWidth: 3,
    borderColor: c.onEmergency,
    ...elevation.md,
  },
  fabPressed: { backgroundColor: c.emergencyPressed },
  fabFocused: { borderColor: c.focus },
  fabLabel: { color: c.onEmergency, fontFamily: fontFamily.bold, flexShrink: 1 },
  sheet: { gap: space[3], paddingBottom: space[2] },
  dial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: 72,
    paddingHorizontal: space[5],
    paddingVertical: space[3],
    borderRadius: radius.lg,
    backgroundColor: c.emergencyBg,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  dialText: { flex: 1 },
  dialNumber: { color: c.onEmergency, fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 34 },
}));
