/**
 * Terms of Use / Privacy Policy — PLACEHOLDER summaries, visibly marked as a
 * draft pending legal review (product/legal decision: the final text is
 * supplied later; do not present this as the official policy).
 *
 * TO REPLACE WITH THE FINAL TEXT:
 *   1. Edit the `legal.terms.*` / `legal.privacy.*` keys in
 *      src/i18n/translations.ts (sw AND en) and list them in POINTS below.
 *   2. Set LEGAL_TEXT_IS_DRAFT to false — that removes the RASIMU banner and
 *      the "(RASIMU)" title suffix everywhere.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { useT } from '../../src/i18n';
import type { TranslationKey } from '../../src/i18n/translations';
import { space, useTheme } from '../../src/theme/theme';
import { Banner, Card, EmergencyShell, Header, Icon, Screen, Text } from '../../src/ui';

/** Flip to false only once legal has approved the final text. */
const LEGAL_TEXT_IS_DRAFT = true;

const POINTS: Record<'terms' | 'privacy', readonly TranslationKey[]> = {
  terms: ['legal.terms.1', 'legal.terms.2', 'legal.terms.3', 'legal.terms.4', 'legal.terms.5'],
  privacy: ['legal.privacy.1', 'legal.privacy.2', 'legal.privacy.3', 'legal.privacy.4', 'legal.privacy.5'],
};

export default function LegalDocument(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ doc: string }>();
  const doc = params.doc === 'privacy' ? 'privacy' : 'terms';
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <EmergencyShell>
      <Screen
        header={
          <Header
            title={LEGAL_TEXT_IS_DRAFT ? `${t(`legal.${doc}.title`)} (${t('legal.draftTag')})` : t(`legal.${doc}.title`)}
            onBack={back}
          />
        }
      >
        {LEGAL_TEXT_IS_DRAFT ? <Banner tone="warning" icon="edit-3" title={t('legal.draftTag')} message={t('legal.draft')} /> : null}
        <Card>
          {POINTS[doc].map((key) => (
            <View key={key} style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
              <Icon name="check" size={18} color={colors.primary} />
              <Text style={{ flex: 1 }}>{t(key)}</Text>
            </View>
          ))}
        </Card>
      </Screen>
    </EmergencyShell>
  );
}
