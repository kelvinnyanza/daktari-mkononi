import { View } from 'react-native';
import { createStyles, radius } from '../theme/theme';

/**
 * Thin progress bar (profile completion). Announced as a progressbar with its
 * value; always paired with a text label (colour is never the only signal).
 */
export function ProgressBar({ percent, accessibilityLabel }: { percent: number; accessibilityLabel: string }): React.JSX.Element {
  const styles = useStyles();
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View
      style={styles.track}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: value }}
    >
      <View style={[styles.fill, { width: `${value}%` }]} />
    </View>
  );
}

const useStyles = createStyles((c) => ({
  track: { height: 8, borderRadius: radius.pill, backgroundColor: c.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: c.primary },
}));
