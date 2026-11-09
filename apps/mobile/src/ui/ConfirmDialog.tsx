import { useEffect, useRef } from 'react';
import { BackHandler, Modal, Pressable, View } from 'react-native';
import { createStyles, elevation, radius, space } from '../theme/theme';
import { Button, type ButtonVariant } from './Button';
import { Icon, type IconName } from './Icon';
import { useHasOverlayHost, useOverlay } from './OverlayHost';
import { Text } from './Text';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** `danger` = outlined red (destructive). Solid red is reserved for 112/115. */
  confirmVariant?: ButtonVariant;
  icon?: IconName;
  busy?: boolean;
}

/**
 * In-app confirmation (replaces Alert.alert, which would dim the emergency
 * strip). Renders in the OverlayHost below the strip; Modal fallback outside
 * a shell. Back / backdrop = cancel. The safe choice is listed first.
 */
export function ConfirmDialog(props: ConfirmDialogProps): React.JSX.Element | null {
  const hasHost = useHasOverlayHost();
  const layer = <DialogLayer {...props} />;
  useOverlay(hasHost && props.visible ? layer : null);
  if (hasHost) return null;
  return (
    <Modal visible={props.visible} transparent animationType="fade" statusBarTranslucent onRequestClose={props.onCancel}>
      {layer}
    </Modal>
  );
}

function DialogLayer({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  confirmVariant = 'danger',
  icon = 'alert-triangle',
  busy = false,
}: Omit<ConfirmDialogProps, 'visible'>): React.JSX.Element {
  const styles = useStyles();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      cancelRef.current();
      return true;
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.root}>
      <Pressable style={styles.backdrop} onPress={onCancel} accessibilityRole="button" accessibilityLabel={cancelLabel} />
      <View style={styles.card} accessibilityViewIsModal accessibilityRole="alert">
        <View style={styles.iconHalo}>
          <Icon name={icon} size={28} color={styles.iconColor.color} />
        </View>
        <Text variant="title" align="center" accessibilityRole="header">
          {title}
        </Text>
        <Text tone="secondary" align="center">
          {message}
        </Text>
        <View style={styles.actions}>
          <Button variant="secondary" label={cancelLabel} onPress={onCancel} disabled={busy} />
          <Button variant={confirmVariant} label={confirmLabel} onPress={onConfirm} loading={busy} />
        </View>
      </View>
    </View>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space[6] },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: c.overlay },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    padding: space[6],
    gap: space[3],
    alignItems: 'center',
    ...elevation.md,
  },
  iconHalo: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: c.dangerBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconColor: { color: c.dangerFg },
  actions: { alignSelf: 'stretch', gap: space[2], marginTop: space[2] },
}));
