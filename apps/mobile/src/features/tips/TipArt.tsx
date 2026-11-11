import type { PublicHealthTip } from '@daktari/schemas';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { createStyles, radius } from '../../theme/theme';
import { apiUrl } from './tips-api';

/* eslint-disable @typescript-eslint/no-require-imports -- bundled art (pnpm illustrations) */
const ILLUSTRATIONS: Readonly<Record<string, ImageSourcePropType>> = {
  'eating-together': require('../../../assets/illustrations/eating-together.png') as ImageSourcePropType,
  'garden-harvest': require('../../../assets/illustrations/garden-harvest.png') as ImageSourcePropType,
  'sunny-walk': require('../../../assets/illustrations/sunny-walk.png') as ImageSourcePropType,
  'bike-ride': require('../../../assets/illustrations/bike-ride.png') as ImageSourcePropType,
  'drinking-water': require('../../../assets/illustrations/drinking-water.png') as ImageSourcePropType,
  meditation: require('../../../assets/illustrations/meditation.png') as ImageSourcePropType,
  'relaxing-outdoors': require('../../../assets/illustrations/relaxing-outdoors.png') as ImageSourcePropType,
  'doctor-notes': require('../../../assets/illustrations/doctor-notes.png') as ImageSourcePropType,
  'heart-check': require('../../../assets/illustrations/heart-check.png') as ImageSourcePropType,
  'parent-and-baby': require('../../../assets/illustrations/parent-and-baby.png') as ImageSourcePropType,
  'safe-home': require('../../../assets/illustrations/safe-home.png') as ImageSourcePropType,
  protection: require('../../../assets/illustrations/protection.png') as ImageSourcePropType,
};
/* eslint-enable @typescript-eslint/no-require-imports */

const FALLBACK = ILLUSTRATIONS.protection!;

/**
 * The tip's artwork in a fixed-height soft-teal frame (no layout jump while
 * loading). Bundled illustrations work offline; an uploaded image comes from
 * its versioned URL and is cached by the platform image cache.
 */
export function TipArt({ tip, height }: { tip: Pick<PublicHealthTip, 'illustration' | 'imageUrl'>; height: number }): React.JSX.Element {
  const styles = useStyles();
  const source: ImageSourcePropType =
    tip.imageUrl !== null ? { uri: apiUrl(tip.imageUrl) } : (ILLUSTRATIONS[tip.illustration] ?? FALLBACK);
  return (
    <View style={[styles.frame, { height }]} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image
        source={source}
        style={tip.imageUrl !== null ? styles.photo : styles.illustration}
        resizeMode={tip.imageUrl !== null ? 'cover' : 'contain'}
        fadeDuration={0}
      />
    </View>
  );
}

const useStyles = createStyles((c) => ({
  frame: {
    width: '100%',
    backgroundColor: c.primarySoft,
    borderRadius: radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: { width: '82%', height: '86%' },
  photo: { width: '100%', height: '100%' },
}));
