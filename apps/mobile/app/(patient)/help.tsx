/**
 * Profile → Msaada: emergency reminder, common questions, contact. Contact
 * details come from the build's optional EXPO_PUBLIC_SUPPORT_* settings and
 * are never guessed.
 */
import { useRouter } from 'expo-router';
import { Linking, View } from 'react-native';
import { useT } from '../../src/i18n';
import type { TranslationKey } from '../../src/i18n/translations';
import { SUPPORT_CONTACT } from '../../src/services/config';
import { space } from '../../src/theme/theme';
import { Banner, Button, Card, Header, Screen, Text } from '../../src/ui';

const FAQ: ReadonlyArray<[TranslationKey, TranslationKey]> = [
  ['help.q1', 'help.a1'],
  ['help.q2', 'help.a2'],
  ['help.q3', 'help.a3'],
  ['help.q4', 'help.a4'],
];

export default function Help(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/(patient)/profile'));
  const { phone, email } = SUPPORT_CONTACT;

  return (
    <Screen header={<Header title={t('help.title')} onBack={back} />}>
      <Banner tone="warning" icon="alert-triangle" message={t('help.emergency')} />
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('help.faq')}
        </Text>
        {FAQ.map(([q, a]) => (
          <View key={q} style={{ gap: space[1] }}>
            <Text variant="bodyStrong">{t(q)}</Text>
            <Text tone="secondary">{t(a)}</Text>
          </View>
        ))}
      </Card>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('help.contact')}
        </Text>
        {phone === null && email === null ? <Text tone="secondary">{t('help.contact.soon')}</Text> : null}
        {phone !== null ? (
          <Button
            variant="secondary"
            icon="phone"
            label={t('help.contact.phone', { phone })}
            onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => undefined)}
          />
        ) : null}
        {email !== null ? (
          <Button
            variant="secondary"
            icon="mail"
            label={t('help.contact.email', { email })}
            onPress={() => void Linking.openURL(`mailto:${email}`).catch(() => undefined)}
          />
        ) : null}
      </Card>
    </Screen>
  );
}
