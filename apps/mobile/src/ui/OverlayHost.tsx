/**
 * In-tree overlay layer for bottom sheets and dialogs.
 *
 * Why not RN <Modal> / Alert: both draw over the WHOLE window, so the 112/115
 * emergency button would be dimmed and unreachable while a sheet is open. The
 * host lives INSIDE EmergencyShell's body: overlays cover the screen and tab
 * bar, and the shell draws the "Dharura" button above them (moved to the
 * top-right while an overlay is open — onCoveredChange), full red and
 * tappable. While an overlay is open, the screen underneath is hidden from
 * screen readers; the button is not.
 *
 * Overlay content is rendered at the host's position in the tree: it gets the
 * app-wide providers (query client, theme, i18n), not the screen's navigator —
 * keep route-specific hooks (useLocalSearchParams) out of sheet content.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

interface OverlayApi {
  show: (id: string, node: ReactNode) => void;
  hide: (id: string) => void;
}

const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayHost({
  children,
  onCoveredChange,
}: PropsWithChildren<{ onCoveredChange?: (covered: boolean) => void }>): React.JSX.Element {
  const [layers, setLayers] = useState<ReadonlyArray<{ id: string; node: ReactNode }>>([]);
  const api = useMemo<OverlayApi>(
    () => ({
      show: (id, node) =>
        setLayers((current) =>
          current.some((layer) => layer.id === id)
            ? current.map((layer) => (layer.id === id ? { id, node } : layer))
            : [...current, { id, node }],
        ),
      hide: (id) => setLayers((current) => current.filter((layer) => layer.id !== id)),
    }),
    [],
  );
  const covered = layers.length > 0;
  const coveredRef = useRef(onCoveredChange);
  coveredRef.current = onCoveredChange;
  useEffect(() => {
    coveredRef.current?.(covered);
  }, [covered]);
  return (
    <OverlayContext.Provider value={api}>
      <View
        style={styles.fill}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={covered}
      >
        {children}
      </View>
      {layers.map((layer) => (
        <View key={layer.id} style={styles.layer} pointerEvents="box-none">
          {layer.node}
        </View>
      ))}
    </OverlayContext.Provider>
  );
}

/** True inside an OverlayHost (patient/auth shells). */
export function useHasOverlayHost(): boolean {
  return useContext(OverlayContext) !== null;
}

/**
 * Shows `node` in the nearest OverlayHost while it is non-null. Re-publishes on
 * every render so the overlay reflects the caller's latest state. No-op
 * without a host (callers then fall back to <Modal>).
 */
export function useOverlay(node: ReactNode | null): void {
  const host = useContext(OverlayContext);
  const id = useId();
  useEffect(() => {
    if (host === null) return;
    if (node === null) host.hide(id);
    else host.show(id, node);
  });
  useEffect(() => () => host?.hide(id), [host, id]);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Above the tab bar: on Android, elevation decides stacking order, and the
  // tab bar has its own elevation — a plain later sibling would draw under it.
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 24 },
});
