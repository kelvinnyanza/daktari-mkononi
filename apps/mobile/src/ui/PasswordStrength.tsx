import { View } from 'react-native';
import { useT } from '../i18n';
import { passwordRules, passwordStrength } from '../lib/password-strength';
import { createStyles, radius, space, useTheme } from '../theme/theme';
import { Icon } from './Icon';
import { Text } from './Text';

/**
 * Live hint under the registration password: the server's rules as a
 * checklist (ticked as they are met) and a three-step strength meter. The
 * level is always spelled out in words — colour is never the only signal.
 */
export function PasswordStrength({ password }: { password: string }): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const { colors } = useTheme();
  const rules = passwordRules(password);
  const level = passwordStrength(password);
  const filled = level === 'strong' ? 3 : level === 'fair' ? 2 : level === 'weak' ? 1 : 0;
  const tone = level === 'strong' ? colors.successFg : level === 'fair' ? colors.warningFg : colors.dangerFg;

  const items = [
    { met: rules.minLength, label: t('auth.password.rule.length') },
    { met: rules.letter && rules.digit, label: t('auth.password.rule.mix') },
  ];

  return (
    <View style={styles.wrap}>
      {level !== 'empty' ? (
        <View style={styles.meterRow} accessible accessibilityLabel={t(`auth.password.strength.${level}`)}>
          <View style={styles.meter}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.segment, { backgroundColor: i < filled ? tone : colors.border }]} />
            ))}
          </View>
          <Text variant="caption" style={{ color: tone }}>
            {t(`auth.password.strength.${level}`)}
          </Text>
        </View>
      ) : null}
      {items.map((item) => (
        <View key={item.label} style={styles.rule}>
          <Icon
            name={item.met ? 'check-circle' : 'circle'}
            size={16}
            color={item.met ? colors.successFg : colors.textSecondary}
          />
          <Text variant="caption" tone="secondary" style={styles.ruleText}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = createStyles(() => ({
  wrap: { gap: space[1] },
  meterRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  meter: { flexDirection: 'row', gap: space[1], flex: 1, maxWidth: 160 },
  segment: { flex: 1, height: 6, borderRadius: radius.pill },
  rule: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  ruleText: { flexShrink: 1 },
}));
