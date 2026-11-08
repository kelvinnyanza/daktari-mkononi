/**
 * Full-area states: Empty, Error (incl. offline "Hakuna mtandao"). Each has a
 * soft circular "illustration" (icon on a tint), a short line, ONE action.
 */
import { View } from 'react-native';
import { useT } from '../i18n';
import { createStyles, space, useTheme } from '../theme/theme';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

function Illustration({ icon, tone }: { icon: IconName; tone: 'primary' | 'danger' | 'neutral' }): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  const bg = tone === 'primary' ? colors.primarySoft : tone === 'danger' ? colors.dangerBg : colors.neutralBg;
  const fg = tone === 'primary' ? colors.primary : tone === 'danger' ? colors.dangerFg : colors.neutralFg;
  return (
    <View style={[styles.halo, { backgroundColor: bg }]}>
      <View style={[styles.core, { borderColor: bg }]}>
        <Icon name={icon} size={32} color={fg} />
      </View>
    </View>
  );
}

export interface StateAction {
  label: string;
  onPress: () => void;
  icon?: IconName;
}

export function EmptyState({
  icon = 'inbox',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: StateAction;
}): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.box}>
      <Illustration icon={icon} tone="primary" />
      <View style={styles.copy}>
        <Text variant="heading" align="center" accessibilityRole="header">
          {title}
        </Text>
        {message !== undefined ? (
          <Text tone="secondary" align="center">
            {message}
          </Text>
        ) : null}
      </View>
      {action !== undefined ? (
        <Button label={action.label} onPress={action.onPress} {...(action.icon ? { icon: action.icon } : {})} fullWidth={false} />
      ) : null}
    </View>
  );
}

/**
 * kind="offline" → "Hakuna mtandao" copy + wifi-off; kind="error" → generic
 * (pass the API's bilingual message when there is one).
 */
export function ErrorState({
  kind = 'error',
  title,
  message,
  onRetry,
}: {
  kind?: 'error' | 'offline';
  title?: string;
  message?: string;
  onRetry?: () => void;
}): React.JSX.Element {
  const styles = useStyles();
  const t = useT();
  const offline = kind === 'offline';
  return (
    <View style={styles.box} accessibilityLiveRegion="polite">
      <Illustration icon={offline ? 'wifi-off' : 'alert-circle'} tone={offline ? 'neutral' : 'danger'} />
      <View style={styles.copy}>
        <Text variant="heading" align="center" accessibilityRole="header">
          {title ?? (offline ? t('ui.offline.title') : t('ui.error.title'))}
        </Text>
        <Text tone="secondary" align="center">
          {message ?? (offline ? t('ui.offline.body') : t('common.error.generic'))}
        </Text>
      </View>
      {onRetry !== undefined ? (
        <Button label={t('common.retry')} icon="refresh-cw" variant="secondary" onPress={onRetry} fullWidth={false} />
      ) : null}
    </View>
  );
}

const useStyles = createStyles(() => ({
  box: {
    alignItems: 'center',
    gap: space[4],
    paddingVertical: space[10],
    paddingHorizontal: space[4],
  },
  copy: { gap: space[1], alignItems: 'center', maxWidth: 420, alignSelf: 'stretch' },
  halo: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  core: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
