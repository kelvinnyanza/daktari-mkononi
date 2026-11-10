/**
 * First-launch introduction (UI Phase 2): four swipeable pages, shown once per
 * install (src/lib/onboarding.ts). "Ruka" on every page, page dots, "Endelea";
 * the last page offers "Anza sasa" (→ register) and "Tayari nina akaunti?
 * Ingia" (→ login). Skipping counts as seen.
 *
 * Layout: image above text on phones and portrait tablets, side by side in
 * landscape. The image frame has a fixed size computed from the window, so
 * nothing moves while a photo decodes; at large font sizes the image shrinks
 * and the text scrolls.
 */
import { useRouter, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Image,
  ScrollView,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useT } from '../src/i18n';
import type { TranslationKey } from '../src/i18n/translations';
import { markOnboardingSeen } from '../src/lib/onboarding';
import { createStyles, layout, radius, space, useTheme } from '../src/theme/theme';
import { Button, EmergencyShell, Icon, LogoMark, Text, type IconName } from '../src/ui';

interface Slide {
  key: '1' | '2' | '3' | '4';
  /** null → the calm design-system placeholder (also used if a photo fails to load). */
  image: ImageSourcePropType | null;
  icon: IconName;
}

// Photos are matched to the message they illustrate: the video-call photo
// (onboarding-4.jpg) goes with "talk to a doctor", the doctor writing in a
// file (onboarding-3.jpg) with "your records are private".
// Optimised copies (pnpm onboarding:images) — ~50 KB each.
/* eslint-disable @typescript-eslint/no-require-imports */
const SLIDES: readonly Slide[] = [
  { key: '1', image: require('../assets/onboarding/onboarding-1.jpg') as ImageSourcePropType, icon: 'heart' },
  { key: '2', image: require('../assets/onboarding/onboarding-2.jpg') as ImageSourcePropType, icon: 'activity' },
  { key: '3', image: require('../assets/onboarding/onboarding-4.jpg') as ImageSourcePropType, icon: 'video' },
  { key: '4', image: require('../assets/onboarding/onboarding-3.jpg') as ImageSourcePropType, icon: 'lock' },
];
/* eslint-enable @typescript-eslint/no-require-imports */

const key = (slide: Slide, part: 'title' | 'body' | 'alt'): TranslationKey => `onboarding.${slide.key}.${part}`;

export default function Onboarding(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;

  // Keep the current page in view when the window resizes (rotation, split screen).
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: index * width, animated: false });
    // Only on width change: index is read at that moment on purpose.
  }, [width]);

  useEffect(() => {
    const slide = SLIDES[index];
    if (slide !== undefined) AccessibilityInfo.announceForAccessibility(t(key(slide, 'title')));
  }, [index, t]);

  const finish = (target: Href): void => {
    void markOnboardingSeen();
    router.replace(target);
  };

  const goTo = (next: number): void => {
    listRef.current?.scrollToOffset({ offset: next * width, animated: true });
    setIndex(next);
  };

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const next = Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (next !== index && next >= 0 && next < SLIDES.length) setIndex(next);
  };

  return (
    <EmergencyShell>
      <SafeAreaView style={styles.root} edges={['left', 'right', 'bottom']}>
        <View style={styles.topBar}>
          <LogoMark size={32} />
          <Button
            variant="ghost"
            size="sm"
            fullWidth={false}
            label={t('onboarding.skip')}
            accessibilityHint={t('onboarding.skip.a11y')}
            onPress={() => finish('/(auth)/register')}
            testID="onboarding-skip"
          />
        </View>

        <FlatList
          ref={listRef}
          data={SLIDES}
          keyExtractor={(slide) => slide.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onMomentumScrollEnd={onScrollEnd}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item }) => <Page slide={item} width={width} />}
          style={styles.list}
        />

        <View style={styles.bottom}>
          <View style={styles.bottomInner}>
            <Dots count={SLIDES.length} index={index} label={t('onboarding.progress', { page: index + 1, pages: SLIDES.length })} />
            {last ? (
              <>
                <Button label={t('onboarding.start')} icon="arrow-right" onPress={() => finish('/(auth)/register')} testID="onboarding-start" />
                <Button variant="ghost" label={t('onboarding.haveAccount')} onPress={() => finish('/(auth)/login')} />
              </>
            ) : (
              <Button label={t('onboarding.next')} icon="arrow-right" onPress={() => goTo(index + 1)} testID="onboarding-next" />
            )}
          </View>
        </View>
      </SafeAreaView>
    </EmergencyShell>
  );
}

function Page({ slide, width }: { slide: Slide; width: number }): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const { height, fontScale } = useWindowDimensions();
  const landscape = width > height && width >= layout.tabletBreakpoint;
  const gutter = width >= layout.tabletBreakpoint ? layout.gutterTablet : layout.gutterPhone;

  // Fixed frame sizes → no layout jump while the photo decodes.
  const column = Math.min(width - gutter * 2, 560);
  const imageShare = fontScale > 1.3 ? 0.3 : 0.42;
  const frame = landscape
    ? { width: Math.min((width - gutter * 3) * 0.45, height * 0.6), height: height * 0.6 }
    : { width: column, height: Math.min(column * 1.5, height * imageShare) };

  return (
    <View style={[styles.page, { width, paddingHorizontal: gutter }, landscape && styles.pageLandscape]}>
      <SlideImage slide={slide} width={frame.width} height={frame.height} />
      <ScrollView
        style={landscape ? styles.copyLandscape : styles.copyPortrait}
        contentContainerStyle={[styles.copyContent, { maxWidth: column }]}
      >
        <Text variant="display" accessibilityRole="header">
          {t(key(slide, 'title'))}
        </Text>
        <Text tone="secondary" style={styles.body}>
          {t(key(slide, 'body'))}
        </Text>
      </ScrollView>
    </View>
  );
}

function SlideImage({ slide, width, height }: { slide: Slide; width: number; height: number }): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const photo = failed ? null : slide.image;
  return (
    <View
      style={[styles.frame, { width, height }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t(key(slide, 'alt'))}
    >
      {photo !== null ? (
        <Image
          source={photo}
          style={styles.photo}
          resizeMode="cover"
          fadeDuration={150}
          onError={() => setFailed(true)}
          accessible={false}
        />
      ) : (
        // Calm placeholder from the design system: soft teal, rings, one icon.
        <View style={styles.placeholder} testID={`onboarding-placeholder-${slide.key}`}>
          <View style={[styles.ring, { width: width * 0.9, height: width * 0.9 }]} />
          <View style={[styles.ring, { width: width * 0.6, height: width * 0.6 }]} />
          <View style={styles.placeholderIcon}>
            <Icon name={slide.icon} size={40} color={colors.primary} />
          </View>
        </View>
      )}
    </View>
  );
}

function Dots({ count, index, label }: { count: number; index: number; label: string }): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.dots} accessible accessibilityLabel={label}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
      ))}
    </View>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
  },
  list: { flex: 1 },
  page: { flex: 1, alignItems: 'center', gap: space[5], paddingTop: space[2] },
  pageLandscape: { flexDirection: 'row', justifyContent: 'center', gap: space[8] },
  frame: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: c.primarySoft,
  },
  photo: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.primarySoft },
  ring: {
    position: 'absolute',
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: c.surface,
  },
  placeholderIcon: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: c.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyPortrait: { flex: 1, alignSelf: 'stretch' },
  copyLandscape: { flex: 1, maxWidth: 480, alignSelf: 'center' },
  copyContent: { gap: space[3], width: '100%', alignSelf: 'center', paddingBottom: space[4] },
  body: { fontSize: 17, lineHeight: 26 },
  bottom: { alignItems: 'center', paddingHorizontal: space[4], paddingBottom: space[4], paddingTop: space[2] },
  bottomInner: { width: '100%', maxWidth: 480, gap: space[3] },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space[2], paddingVertical: space[2] },
  dot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: c.borderStrong },
  dotActive: { width: 24, backgroundColor: c.primary },
}));
