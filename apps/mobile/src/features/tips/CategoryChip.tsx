import type { HealthTipCategory } from '@daktari/schemas';
import { View } from 'react-native';
import { useT } from '../../i18n';
import { fontFamily } from '../../theme/fonts';
import { createStyles, radius, space } from '../../theme/theme';
import { Text } from '../../ui';

/** Small teal label naming a tip's category (not interactive). */
export function CategoryChip({ category }: { category: HealthTipCategory }): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  return (
    <View style={styles.chip}>
      <Text variant="caption" style={styles.label}>
        {t(`tips.category.${category}`)}
      </Text>
    </View>
  );
}

const useStyles = createStyles((c) => ({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space[2] + 2,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: c.primarySoft,
  },
  label: { color: c.onPrimarySoft, fontFamily: fontFamily.semibold },
}));
