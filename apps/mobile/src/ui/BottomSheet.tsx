import { useEffect, useRef, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, BackHandler, Easing, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../i18n';
import { createStyles, elevation, layout, radius, space } from '../theme/theme';
import { IconButton } from './IconButton';
import { useHasOverlayHost, useOverlay } from './OverlayHost';
import { Text } from './Text';

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
}

/**
 * Bottom sheet: one 220ms native-driver slide, no gesture library. Closes on
 * backdrop tap, the close button ("Funga"/"Close") and Android back.
 * Centered with a max width on tablets.
 *
 * Inside the patient/auth shells it renders in the OverlayHost BELOW the
 * emergency strip, so 112/115 is never dimmed or covered. Outside a shell
 * (dev preview only) it falls back to a full-window RN Modal.
 */
export function BottomSheet({ visible, onClose, title, children }: PropsWithChildren<SheetProps>): React.JSX.Element | null {
  const hasHost = useHasOverlayHost();
  const layer = (
    <SheetLayer onClose={onClose} title={title}>
      {children}
    </SheetLayer>
  );
  useOverlay(hasHost && visible ? layer : null);
  if (hasHost) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {layer}
    </Modal>
  );
}

function SheetLayer({ onClose, title, children }: PropsWithChildren<Omit<SheetProps, 'visible'>>): React.JSX.Element {
  const styles = useStyles();
  const t = useT();
  const insets = useSafeAreaInsets();
  const offset = useRef(new Animated.Value(1)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Android back closes the sheet first (what <Modal onRequestClose> did).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (cancelled) return;
        if (reduce) {
          offset.setValue(0);
          return;
        }
        Animated.timing(offset, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      })
      .catch(() => offset.setValue(0));
    return () => {
      cancelled = true;
    };
  }, [offset]);

  const translateY = offset.interpolate({ inputRange: [0, 1], outputRange: [0, 400] });

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('a11y.close')} />
      <Animated.View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space[4]), transform: [{ translateY }] }]}
        accessibilityViewIsModal
      >
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text variant="title" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <IconButton icon="x" accessibilityLabel={t('a11y.close')} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.overlay },
  sheet: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    maxHeight: '88%',
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space[2],
    ...elevation.md,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    marginBottom: space[1],
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: space[4],
    paddingRight: space[2],
    gap: space[2],
  },
  title: { flex: 1 },
  content: { padding: space[4], gap: space[4] },
}));
