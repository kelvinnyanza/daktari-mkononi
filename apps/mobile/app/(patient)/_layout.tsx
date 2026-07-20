import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';
import { EmergencyBanner } from '../../src/components/ui';
import { useT } from '../../src/i18n';
import { colors } from '../../src/theme/tokens';

/** Text-glyph tab icons — no icon font download on 2G. */
function TabGlyph({ glyph, color }: { glyph: string; color: string }): React.JSX.Element {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}

export default function PatientLayout(): React.JSX.Element {
  const t = useT();
  return (
    <View style={{ flex: 1 }}>
      <EmergencyBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: t('tabs.home'),
            tabBarIcon: ({ color }) => <TabGlyph glyph="⌂" color={color} />,
          }}
        />
        <Tabs.Screen
          name="appointments"
          options={{
            title: t('tabs.appointments'),
            tabBarIcon: ({ color }) => <TabGlyph glyph="🗓" color={color} />,
          }}
        />
        <Tabs.Screen
          name="records"
          options={{
            title: t('tabs.records'),
            tabBarIcon: ({ color }) => <TabGlyph glyph="🗎" color={color} />,
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('tabs.profile'),
            tabBarIcon: ({ color }) => <TabGlyph glyph="👤" color={color} />,
          }}
        />
        {/* Reachable via navigation, not tabs. */}
        <Tabs.Screen name="screening" options={{ href: null }} />
        <Tabs.Screen name="doctors" options={{ href: null }} />
        <Tabs.Screen name="consultation" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
