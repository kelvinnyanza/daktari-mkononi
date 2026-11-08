import { StatusBar } from 'expo-status-bar';
import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createStyles } from '../theme/theme';
import { EmergencyStrip } from './Banner';

/**
 * Layout shell for the auth and patient stacks: the emergency strip owns the
 * top safe area (red behind the status bar, light status icons), so screens
 * inside use <Screen> with its default edges (no top inset).
 */
export function EmergencyShell({ children }: PropsWithChildren): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.top}>
        <EmergencyStrip />
      </SafeAreaView>
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  top: { backgroundColor: c.emergencyBg },
  body: { flex: 1 },
}));
