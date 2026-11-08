import { useEffect, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, Easing, View, type DimensionValue } from 'react-native';
import { useT } from '../i18n';
import { createStyles, radius, space } from '../theme/theme';

/**
 * One shared pulse for every skeleton on screen (a single native-driver
 * loop, not one per block). Stops when the last skeleton unmounts; static
 * when the system "remove animations" setting is on.
 */
const pulse = new Animated.Value(1);
let mounted = 0;
let loop: Animated.CompositeAnimation | null = null;

function usePulse(): Animated.Value {
  useEffect(() => {
    let cancelled = false;
    mounted += 1;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled || reduce || loop !== null) return;
        loop = Animated.loop(
          Animated.sequence([
            Animated.timing(pulse, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          ]),
        );
        loop.start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      mounted -= 1;
      if (mounted === 0 && loop !== null) {
        loop.stop();
        loop = null;
        pulse.setValue(1);
      }
    };
  }, []);
  return pulse;
}

export function Skeleton({
  width = '100%',
  height = 16,
  rounded = radius.sm,
}: {
  width?: DimensionValue;
  height?: number;
  rounded?: number;
}): React.JSX.Element {
  const styles = useStyles();
  const opacity = usePulse();
  return <Animated.View style={[styles.block, { width, height, borderRadius: rounded, opacity }]} />;
}

/**
 * Announces "loading" once for the whole group instead of each grey block.
 * Wrap every skeleton layout in this.
 */
export function SkeletonGroup({ children }: PropsWithChildren): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  // Delay a beat before showing: fast responses never flash grey blocks.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 150);
    return () => clearTimeout(timer);
  }, []);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('a11y.loading')}
      accessibilityState={{ busy: true }}
      style={[styles.group, !visible && styles.hidden]}
    >
      {children}
    </View>
  );
}

export function SkeletonListItem(): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} rounded={radius.pill} />
      <View style={styles.lines}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={12} />
      </View>
    </View>
  );
}

export function SkeletonCard(): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <Skeleton width="50%" height={18} />
      <Skeleton height={12} />
      <Skeleton width="80%" height={12} />
      <Skeleton height={48} rounded={radius.md} />
    </View>
  );
}

const useStyles = createStyles((c) => ({
  block: { backgroundColor: c.border },
  group: { gap: space[3] },
  hidden: { opacity: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  lines: { flex: 1, gap: space[2] },
  card: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
  },
}));
