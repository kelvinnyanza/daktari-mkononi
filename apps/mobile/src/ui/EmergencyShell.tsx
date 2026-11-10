import { StatusBar } from 'expo-status-bar';
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createStyles, space } from '../theme/theme';
import { EMERGENCY_FAB_SIZE, EmergencyFab, EmergencySheet } from './EmergencyFab';
import { OverlayHost } from './OverlayHost';

/** Gap kept under the scroll content so its last item can scroll clear of the button. */
export const EMERGENCY_FAB_CLEARANCE = EMERGENCY_FAB_SIZE + space[4] * 2;

interface ShellApi {
  /** A focused screen's bottom bar height (chat input, call controls, sticky footer); null clears. */
  setLift: (id: string, px: number | null) => void;
  /** Reported by the tab bar (TabBarHeightProbe) so the button sits above it. */
  setTabBarHeight: (px: number) => void;
}

const ShellContext = createContext<ShellApi | null>(null);

/** Internal: lift registration (src/ui/emergency-fab-lift.ts) and the tab-bar probe. */
export function useEmergencyShell(): ShellApi | null {
  return useContext(ShellContext);
}

/** Bottom padding scroll content needs inside a shell (0 outside one, e.g. the dev preview). */
export function useEmergencyFabClearance(): number {
  return useContext(ShellContext) === null ? 0 : EMERGENCY_FAB_CLEARANCE;
}

/**
 * Layout shell for every patient-facing stack (onboarding, auth, patient,
 * legal): the round red "Dharura" button floats bottom-right on every screen,
 * above the content, the tab bar and every overlay. It never covers a key
 * action:
 *  - above the tab bar (measured), and lifted above a focused screen's bottom
 *    bar (chat Send, call controls, sticky Save/Pay footers) via
 *    useEmergencyFabLift;
 *  - scroll content gets EMERGENCY_FAB_CLEARANCE of bottom padding (Screen),
 *    so buttons at the end of a page can always scroll clear of it;
 *  - while a sheet or dialog is open (their actions sit at the bottom/centre)
 *    it moves to the top-right corner, still above the overlay and tappable.
 * Tapping it opens the emergency sheet (112 / 115); it hides while that sheet
 * is open. Sheets and dialogs render in the OverlayHost of the body.
 */
export function EmergencyShell({ children }: PropsWithChildren): React.JSX.Element {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [lifts, setLifts] = useState<Readonly<Record<string, number>>>({});
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [covered, setCovered] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const api = useMemo<ShellApi>(
    () => ({
      setLift: (id, px) =>
        setLifts((current) => {
          if (px === null) {
            if (!(id in current)) return current;
            const { [id]: _removed, ...rest } = current;
            return rest;
          }
          return current[id] === px ? current : { ...current, [id]: px };
        }),
      setTabBarHeight: (px) => setTabBarHeight((current) => (current === px ? current : px)),
    }),
    [],
  );

  const lift = Math.max(0, ...Object.values(lifts));
  const bottom = (tabBarHeight > 0 ? tabBarHeight : insets.bottom) + space[4] + lift;

  return (
    <ShellContext.Provider value={api}>
      <View style={styles.root}>
        <StatusBar style="dark" />
        {/* The shell owns the top inset; screens inside use <Screen> without the top edge. */}
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.top} />
        <View style={styles.body}>
          <OverlayHost onCoveredChange={setCovered}>
            {children}
            <EmergencySheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
          </OverlayHost>
          {sheetOpen ? null : (
            <View
              pointerEvents="box-none"
              style={[styles.fabLayer, covered ? { top: space[2] } : { bottom }]}
            >
              <EmergencyFab onPress={() => setSheetOpen(true)} />
            </View>
          )}
        </View>
      </View>
    </ShellContext.Provider>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  top: { backgroundColor: c.background },
  body: { flex: 1 },
  // Above OverlayHost layers (zIndex 100 / elevation 24).
  fabLayer: { position: 'absolute', right: space[4], zIndex: 200, elevation: 30 },
}));

/**
 * Put in the tab navigator's `tabBarBackground`: measures the bar (including
 * its safe-area padding) so the emergency button sits just above it.
 */
export function TabBarHeightProbe(): React.JSX.Element {
  const shell = useEmergencyShell();
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(event) => shell?.setTabBarHeight(Math.round(event.nativeEvent.layout.height))}
    />
  );
}
