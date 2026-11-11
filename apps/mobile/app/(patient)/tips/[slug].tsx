/**
 * Tip page: large illustration, category, title, reviewer, the article,
 * key-takeaways box, sources (open in the browser), share, and a gentle
 * "Una dalili? Pima sasa" to AI screening. Plain Text throughout, so it
 * reads well at large font sizes; works offline from the cache.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, Pressable, Share, View } from 'react-native';
import { useTip } from '../../../src/features/tips/hooks';
import { CategoryChip } from '../../../src/features/tips/CategoryChip';
import { TipArt } from '../../../src/features/tips/TipArt';
import { TipBody } from '../../../src/features/tips/TipBody';
import { useI18nStore, useT } from '../../../src/i18n';
import { createStyles, radius, space, useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  Header,
  Icon,
  IconButton,
  Screen,
  SkeletonCard,
  SkeletonGroup,
  Text,
  useResponsive,
} from '../../../src/ui';

export default function TipDetail(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const { isTablet } = useResponsive();
  const locale = useI18nStore((state) => state.locale);
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const query = useTip(slug ?? '');
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/(patient)/home'));

  const tip = query.data?.data;
  const share = (): void => {
    if (tip === undefined) return;
    void Share.share({
      message: `${tip.title[locale]}\n\n${tip.summary[locale]}\n\n${tip.takeaways[locale].map((k) => `• ${k}`).join('\n')}\n\n${t('tips.share.footer')}`,
    }).catch(() => undefined);
  };

  return (
    <Screen
      header={
        <Header
          title={t('tips.title')}
          onBack={back}
          right={tip !== undefined ? <IconButton icon="share-2" accessibilityLabel={t('tips.share')} onPress={share} /> : undefined}
        />
      }
    >
      {query.isPending ? (
        <SkeletonGroup>
          <SkeletonCard />
          <SkeletonCard />
        </SkeletonGroup>
      ) : query.isError || tip === undefined ? (
        <Card>
          <ErrorState kind="offline" message={t('tips.unavailable')} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          {query.data?.offline === true ? <Banner tone="warning" icon="wifi-off" message={t('tips.offline')} /> : null}
          <TipArt tip={tip} height={isTablet ? 280 : 200} />
          <View style={styles.titleBlock}>
            <View style={styles.chips}>
              <CategoryChip category={tip.category} />
              {tip.status !== 'PUBLISHED' ? <Badge tone="warning" label={t('tips.draftBadge')} /> : null}
            </View>
            <Text variant="display" accessibilityRole="header">
              {tip.title[locale]}
            </Text>
            {tip.reviewedBy !== null ? (
              <View style={styles.reviewed}>
                <Icon name="check-circle" size={18} color={colors.successFg} />
                <Text variant="label" tone="success" style={styles.flex}>
                  {t('tips.reviewedBy', { name: tip.reviewedBy })}
                </Text>
              </View>
            ) : (
              <Text variant="caption" tone="warning">
                {t('tips.notReviewed')}
              </Text>
            )}
            <Text tone="secondary" style={styles.summary}>
              {tip.summary[locale]}
            </Text>
          </View>

          <TipBody text={tip.body[locale]} />

          <View style={styles.takeaways} accessibilityRole="summary">
            <Text variant="heading" accessibilityRole="header">
              {t('tips.takeaways')}
            </Text>
            {tip.takeaways[locale].map((item) => (
              <View key={item} style={styles.takeawayRow}>
                <Icon name="check" size={18} color={colors.primary} />
                <Text style={styles.flex}>{item}</Text>
              </View>
            ))}
          </View>

          <Card tone="primary">
            <Text variant="heading">{t('tips.symptoms')}</Text>
            <Text>{t('tips.symptoms.body')}</Text>
            <Button
              variant="secondary"
              icon="message-circle"
              label={t('tips.symptoms')}
              onPress={() => router.push('/(patient)/screening')}
              testID="tip-screening"
            />
          </Card>

          <View style={styles.sources}>
            <Text variant="label">{t('tips.sources')}</Text>
            {tip.sources.map((source) => (
              <Pressable
                key={source.url}
                accessibilityRole="link"
                accessibilityLabel={source.name}
                onPress={() => void Linking.openURL(source.url).catch(() => undefined)}
                style={styles.sourceRow}
              >
                <Icon name="external-link" size={16} color={colors.primary} />
                <Text variant="caption" tone="primary" style={styles.sourceText}>
                  {source.name}
                </Text>
              </Pressable>
            ))}
            <Text variant="caption" tone="secondary">
              {t('tips.disclaimer')}
            </Text>
          </View>
        </>
      )}
    </Screen>
  );
}

const useStyles = createStyles((c) => ({
  titleBlock: { gap: space[2] },
  chips: { flexDirection: 'row', gap: space[2], alignItems: 'center', flexWrap: 'wrap' },
  reviewed: { flexDirection: 'row', gap: space[2], alignItems: 'center' },
  flex: { flex: 1 },
  summary: { fontSize: 17, lineHeight: 26 },
  takeaways: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: c.primarySoft,
    borderWidth: 1,
    borderColor: c.primary,
  },
  takeawayRow: { flexDirection: 'row', gap: space[2], alignItems: 'flex-start' },
  sources: { gap: space[2] },
  sourceRow: { flexDirection: 'row', gap: space[2], alignItems: 'center', minHeight: 44 },
  sourceText: { flex: 1, textDecorationLine: 'underline' },
}));
