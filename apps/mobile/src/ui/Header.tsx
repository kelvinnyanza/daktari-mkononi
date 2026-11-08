import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useT } from '../i18n';
import { createStyles, space } from '../theme/theme';
import { IconButton } from './IconButton';
import { Text } from './Text';

/**
 * Screen header. `onBack` shows a 48dp back button labelled "Rudi nyuma" /
 * "Go back". `large` = top-level tab screens (no back, bigger title).
 * The title wraps — never truncated.
 */
export function Header({
  title,
  subtitle,
  onBack,
  right,
  large = false,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  const t = useT();
  return (
    <View style={[styles.bar, large && styles.barLarge]}>
      {onBack !== undefined ? <IconButton icon="arrow-left" accessibilityLabel={t('a11y.back')} onPress={onBack} /> : null}
      <View style={[styles.titles, onBack === undefined && styles.titlesNoBack]}>
        <Text variant={large ? 'display' : 'heading'} accessibilityRole="header">
          {title}
        </Text>
        {subtitle !== undefined ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const useStyles = createStyles((c) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: 56,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    backgroundColor: c.background,
  },
  barLarge: { paddingTop: space[4], paddingBottom: space[2] },
  titles: { flex: 1, paddingVertical: space[1] },
  titlesNoBack: { paddingLeft: space[2] },
  right: { flexDirection: 'row', alignItems: 'center' },
}));
