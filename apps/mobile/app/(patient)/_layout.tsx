import { Tabs } from 'expo-router';
import { useT } from '../../src/i18n';
import { fontFamily } from '../../src/theme/fonts';
import { useTheme } from '../../src/theme/theme';
import { EmergencyShell, Icon, TabBarHeightProbe, type IconName } from '../../src/ui';

function tabIcon(name: IconName) {
  return function TabIcon({ color }: { color: string }): React.JSX.Element {
    return <Icon name={name} color={color} />;
  };
}

export default function PatientLayout(): React.JSX.Element {
  const t = useT();
  const { colors } = useTheme();
  return (
    <EmergencyShell>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
          tabBarLabelStyle: { fontFamily: fontFamily.semibold, fontSize: 12 },
          tabBarItemStyle: { paddingVertical: 4 },
          sceneStyle: { backgroundColor: colors.background },
          // Measures the bar so the emergency button floats just above it.
          tabBarBackground: () => <TabBarHeightProbe />,
        }}
      >
        <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: tabIcon('home') }} />
        <Tabs.Screen name="appointments" options={{ title: t('tabs.appointments'), tabBarIcon: tabIcon('calendar') }} />
        <Tabs.Screen name="records" options={{ title: t('tabs.records'), tabBarIcon: tabIcon('file-text') }} />
        <Tabs.Screen name="profile" options={{ title: t('tabs.profile'), tabBarIcon: tabIcon('user') }} />
        {/* Reachable via navigation, not tabs. */}
        <Tabs.Screen name="screening" options={{ href: null }} />
        <Tabs.Screen name="doctors" options={{ href: null }} />
        <Tabs.Screen name="consultation" options={{ href: null }} />
        <Tabs.Screen name="health-profile" options={{ href: null }} />
        <Tabs.Screen name="tips" options={{ href: null }} />
      </Tabs>
    </EmergencyShell>
  );
}
