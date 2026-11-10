import type { PropsWithChildren, ReactNode } from 'react';
import { View } from 'react-native';
import { createStyles, space } from '../theme/theme';
import { Card, Header, Logo, Screen, Text } from '../ui';

/** Auth forms read best as one narrow column — the same on phones and tablets. */
const FORM_MAX_WIDTH = 480;

/**
 * Login / register frame: logo and a short welcome line on top, the form in a
 * clean card, secondary actions underneath. Same layout at every width.
 */
export function AuthLayout({
  title,
  subtitle,
  onBack,
  backLabel,
  after,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle: string;
  onBack?: () => void;
  /** Header title next to the back arrow (screen-reader context). */
  backLabel?: string;
  /** Below the card: secondary links / buttons. */
  after?: ReactNode;
}>): React.JSX.Element {
  const styles = useStyles();
  return (
    <Screen header={onBack !== undefined ? <Header title={backLabel ?? ''} onBack={onBack} /> : undefined}>
      <View style={styles.column}>
        <View style={[styles.hero, onBack === undefined && styles.heroTop]}>
          <Logo size="md" stacked />
          <View style={styles.welcome}>
            <Text variant="title" align="center" accessibilityRole="header">
              {title}
            </Text>
            <Text tone="secondary" align="center">
              {subtitle}
            </Text>
          </View>
        </View>
        <Card style={styles.card}>{children}</Card>
        {after !== undefined ? <View style={styles.after}>{after}</View> : null}
      </View>
    </Screen>
  );
}

const useStyles = createStyles(() => ({
  column: { width: '100%', maxWidth: FORM_MAX_WIDTH, alignSelf: 'center', gap: space[5] },
  hero: { alignItems: 'center', gap: space[4] },
  heroTop: { paddingTop: space[6] },
  welcome: { gap: space[1], alignItems: 'center' },
  card: { gap: space[4] },
  after: { gap: space[2] },
}));
