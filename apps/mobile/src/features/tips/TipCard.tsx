import type { PublicHealthTip } from '@daktari/schemas';
import { View } from 'react-native';
import { useI18nStore, useT } from '../../i18n';
import { createStyles, radius, space } from '../../theme/theme';
import { Badge, Card, Text } from '../../ui';
import { TipArt } from './TipArt';
import { CategoryChip } from './CategoryChip';

/** Carousel / list card: art, category chip, title, one-line summary, "Soma zaidi". */
export function TipCard({
  tip,
  onPress,
  artHeight = 140,
  width,
}: {
  tip: PublicHealthTip;
  onPress: () => void;
  artHeight?: number;
  width?: number;
}): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const locale = useI18nStore((state) => state.locale);
  const title = tip.title[locale];
  return (
    <Card
      padded={false}
      onPress={onPress}
      accessibilityLabel={`${title}. ${tip.summary[locale]}. ${t('tips.readMore')}`}
      style={[styles.card, width !== undefined && { width }]}
    >
      <TipArt tip={tip} height={artHeight} />
      <View style={styles.body}>
        <View style={styles.chips}>
          <CategoryChip category={tip.category} />
          {tip.status !== 'PUBLISHED' ? <Badge tone="warning" label={t('tips.draftBadge')} /> : null}
        </View>
        <Text variant="heading">{title}</Text>
        <Text tone="secondary" numberOfLines={1}>
          {tip.summary[locale]}
        </Text>
        <Text variant="label" tone="primary">
          {t('tips.readMore')} →
        </Text>
      </View>
    </Card>
  );
}

const useStyles = createStyles(() => ({
  card: { overflow: 'hidden', borderRadius: radius.lg },
  body: { padding: space[4], gap: space[1] + 2 },
  chips: { flexDirection: 'row', gap: space[2], flexWrap: 'wrap', alignItems: 'center' },
}));
