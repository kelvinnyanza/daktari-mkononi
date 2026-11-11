/**
 * Home health-tips carousel.
 *
 *  - Auto-advances every ~6 s; pauses while touched/dragged, while the screen
 *    is not focused (another tab or screen on top) and when the app is in the
 *    background; never auto-scrolls when the system "reduce motion" setting
 *    is on (the user swipes instead).
 *  - Light on budget phones: one FlatList, fixed item layout, at most a few
 *    cards mounted, bundled PNG art, no animation library.
 *  - A small "3/10" counter instead of dots.
 */
import type { PublicHealthTip } from '@daktari/schemas';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  FlatList,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useT } from '../../i18n';
import { createStyles, layout, radius, space } from '../../theme/theme';
import { Text } from '../../ui';
import { TipCard } from './TipCard';

export const AUTO_ADVANCE_MS = 6000;
const GAP = space[3];

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduce(value);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

export function TipsCarousel({
  tips,
  onOpen,
}: {
  tips: readonly PublicHealthTip[];
  onOpen: (tip: PublicHealthTip) => void;
}): React.JSX.Element | null {
  const t = useT();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<PublicHealthTip>>(null);
  const [index, setIndex] = useState(0);
  const [touching, setTouching] = useState(false);
  const [focused, setFocused] = useState(true);
  // Unknown/initial state counts as foreground; only background/inactive pause it.
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const reduceMotion = useReduceMotion();

  // Card width: the content column minus a peek of the next card.
  const gutter = width >= layout.tabletBreakpoint ? layout.gutterTablet : layout.gutterPhone;
  const column = Math.min(width - gutter * 2, layout.maxContentWidth);
  const cardWidth = Math.round(width >= layout.tabletBreakpoint ? (column - GAP) / 2 : column * 0.88);
  const step = cardWidth + GAP;

  // Keep the list where the counter says (a remount or resize resets the offset).
  const indexRef = useRef(index);
  indexRef.current = index;
  const syncOffset = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: indexRef.current * step, animated: false });
  }, [step]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      // After the screen is visible again (web hides inactive tabs, which resets scroll).
      const timer = setTimeout(syncOffset, 60);
      return () => {
        clearTimeout(timer);
        setFocused(false);
      };
    }, [syncOffset]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state !== 'background' && state !== 'inactive'));
    return () => sub.remove();
  }, []);

  const count = tips.length;
  const running = count > 1 && focused && active && !touching && !reduceMotion;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => {
      const next = (index + 1) % count;
      listRef.current?.scrollToOffset({ offset: next * step, animated: true });
      setIndex(next);
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [running, index, count, step]);

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / step);
    if (next >= 0 && next < count) setIndex(next);
    setTouching(false);
  };

  if (count === 0) return null;

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={tips}
        keyExtractor={(tip) => tip.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        disableIntervalMomentum
        getItemLayout={(_, i) => ({ length: step, offset: step * i, index: i })}
        initialNumToRender={2}
        windowSize={3}
        removeClippedSubviews
        onTouchStart={() => setTouching(true)}
        onScrollBeginDrag={() => setTouching(true)}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={(event) => {
          // A drag without momentum (slow release) still ends the touch.
          if (event.nativeEvent.velocity?.x === 0) onScrollEnd(event);
        }}
        onTouchEnd={() => setTouching(false)}
        onLayout={syncOffset}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
        renderItem={({ item }) => <TipCard tip={item} width={cardWidth} onPress={() => onOpen(item)} />}
        accessibilityLabel={t('tips.carousel.a11y', { count })}
      />
      <View style={styles.counter} accessible accessibilityLabel={t('tips.counter.a11y', { n: index + 1, count })}>
        <Text variant="caption" tone="secondary">
          {index + 1}/{count}
        </Text>
      </View>
    </View>
  );
}

const useStyles = createStyles((c) => ({
  wrap: { gap: space[2] },
  content: { paddingRight: space[4] },
  counter: {
    alignSelf: 'center',
    paddingHorizontal: space[2],
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: c.surfaceMuted,
  },
}));
