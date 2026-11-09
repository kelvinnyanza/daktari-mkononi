import { Fragment } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { translate, type Locale } from '../i18n';
import { space, useTheme } from '../theme/theme';
import { EmptyState, Logo, Screen, Text } from '../ui';

const LOCALES: readonly Locale[] = ['sw', 'en'];

/**
 * Shown instead of the whole app when EXPO_PUBLIC_API_URL is missing or
 * invalid. Both languages at once, Swahili first: nothing else in the app
 * works, including the language switch. The emergency line keeps the solid
 * emergency colour.
 */
export function MisconfiguredScreen(): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar style="dark" />
      <Logo size="sm" />
      {LOCALES.map((locale) => (
        <Fragment key={locale}>
          <EmptyState
            icon="tool"
            title={translate('config.misconfigured.title', undefined, locale)}
            message={translate('config.misconfigured.body', undefined, locale)}
          />
          <View style={{ backgroundColor: colors.emergencyBg, borderRadius: 16, padding: space[4] }} accessibilityRole="alert">
            <Text variant="bodyStrong" tone="onEmergency" align="center">
              {translate('config.misconfigured.emergency', undefined, locale)}
            </Text>
          </View>
        </Fragment>
      ))}
    </Screen>
  );
}
