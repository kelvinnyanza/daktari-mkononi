import { Image, View } from 'react-native';
import { useT } from '../i18n';
import { createStyles, space, useTheme } from '../theme/theme';
import { fontFamily } from '../theme/fonts';
import { Text } from './Text';

// Rasterized from assets/brand/logo-mark.svg (pnpm brand:assets); Metro picks @2x/@3x.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MARK = require('../../assets/brand/logo-mark.png') as number;

export function LogoMark({ size = 48 }: { size?: number }): React.JSX.Element {
  return <Image source={MARK} style={{ width: size, height: size }} accessible={false} />;
}

const LOCKUP = {
  sm: { mark: 32, text: 18, line: 24 },
  md: { mark: 44, text: 22, line: 28 },
  lg: { mark: 88, text: 30, line: 38 },
} as const;

/**
 * Lockup: mark + "Daktari" (ink) "Mkononi" (teal). Horizontal for headers,
 * stacked (+ tagline) for login/splash-like moments. Read as one image:
 * "Daktari Mkononi".
 */
export function Logo({
  size = 'md',
  stacked = false,
  tagline = false,
}: {
  size?: keyof typeof LOCKUP;
  stacked?: boolean;
  tagline?: boolean;
}): React.JSX.Element {
  const styles = useStyles();
  const t = useT();
  const { colors } = useTheme();
  const spec = LOCKUP[size];
  return (
    <View
      style={[styles.lockup, stacked && styles.stacked]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('common.appName')}
    >
      <LogoMark size={spec.mark} />
      <View style={stacked ? styles.wordsStacked : styles.words}>
        <Text
          allowFontScaling={false /* logotype is artwork; surrounding copy scales */}
          style={{ fontFamily: fontFamily.bold, fontSize: spec.text, lineHeight: spec.line, color: colors.text }}
        >
          Daktari <Text allowFontScaling={false} style={{ fontFamily: fontFamily.bold, color: colors.primary }}>Mkononi</Text>
        </Text>
        {tagline ? (
          <Text tone="secondary" align={stacked ? 'center' : 'left'}>
            {t('brand.tagline')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = createStyles(() => ({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  stacked: { flexDirection: 'column', gap: space[4] },
  words: { flexShrink: 1 },
  wordsStacked: { alignItems: 'center', gap: space[1] },
}));
