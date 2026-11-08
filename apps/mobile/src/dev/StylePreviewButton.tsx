/**
 * DEV-ONLY button that opens /dev/style-preview (for devices without adb).
 * Only reachable through the `if (__DEV__)` require in
 * src/components/dev-style-preview-entry.tsx — stripped from production.
 * Label is dev copy, deliberately not in i18n/translations.ts.
 */
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useI18nStore } from '../i18n';
import { space } from '../theme/theme';
import { Button, Text } from '../ui';

export function StylePreviewButton(): React.JSX.Element {
  const router = useRouter();
  const en = useI18nStore((state) => state.locale) === 'en';
  return (
    <View style={{ gap: space[1], marginTop: space[4] }}>
      <Text variant="caption" tone="secondary" align="center">
        {en ? 'Development build only' : 'Toleo la majaribio tu'}
      </Text>
      <Button
        variant="secondary"
        size="sm"
        icon="layout"
        label={en ? 'Style preview (dev)' : 'Mwonekano wa muundo (dev)'}
        onPress={() => router.push('/dev/style-preview')}
      />
    </View>
  );
}
