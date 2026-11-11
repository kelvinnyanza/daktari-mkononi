/**
 * "Vidokezo vyote": every published tip, category chips + search, infinite
 * scroll. Works offline from the device cache (with a "Hakuna mtandao" note).
 */
import { healthTipCategorySchema, type HealthTipCategory, type PublicHealthTip } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTipsList } from '../../../src/features/tips/hooks';
import { TipCard } from '../../../src/features/tips/TipCard';
import { useT } from '../../../src/i18n';
import { createStyles, layout, space, useTheme } from '../../../src/theme/theme';
import {
  Banner,
  ChipGroup,
  EmptyState,
  ErrorState,
  Header,
  Input,
  SkeletonCard,
  SkeletonGroup,
  useEmergencyFabClearance,
  useResponsive,
} from '../../../src/ui';

type Filter = HealthTipCategory | 'ALL';

export default function TipsList(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const { gutter, isTablet } = useResponsive();
  const clearance = useEmergencyFabClearance();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // Search after typing pauses (no request per keystroke on slow networks).
  useEffect(() => {
    const timer = setTimeout(() => setQ(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useTipsList(filter === 'ALL' ? null : filter, q);
  const tips = useMemo(() => query.data?.pages.flatMap((page) => page.data.items) ?? [], [query.data]);
  const offline = query.data?.pages.some((page) => page.offline) ?? false;
  const open = (tip: PublicHealthTip): void => router.push({ pathname: '/(patient)/tips/[slug]', params: { slug: tip.slug } });
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/(patient)/home'));

  const options = useMemo(
    () => [
      { value: 'ALL' as const, label: t('tips.category.all') },
      ...healthTipCategorySchema.options.map((value) => ({ value, label: t(`tips.category.${value}`) })),
    ],
    [t],
  );

  const header = (
    <View style={styles.headerBlock}>
      <Input
        label={t('tips.search')}
        leadingIcon="search"
        value={search}
        onChangeText={setSearch}
        placeholder={t('tips.search.placeholder')}
        returnKeyType="search"
        testID="tips-search"
      />
      <ChipGroup<Filter> options={options} value={filter} onChange={setFilter} scroll />
      {offline ? <Banner tone="warning" icon="wifi-off" message={t('tips.offline')} /> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.root} edges={['left', 'right']}>
      <View style={styles.headerWrap}>
        <Header title={t('tips.all')} onBack={back} />
      </View>
      <FlatList
        data={query.isPending || query.isError ? [] : tips}
        key={isTablet ? 'grid' : 'list'}
        numColumns={isTablet ? 2 : 1}
        keyExtractor={(tip) => tip.id}
        columnWrapperStyle={isTablet ? { gap: space[3] } : undefined}
        contentContainerStyle={[styles.content, { paddingHorizontal: gutter, paddingBottom: space[8] + clearance }]}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <View style={isTablet ? styles.gridCell : undefined}>
            <TipCard tip={item} onPress={() => open(item)} artHeight={isTablet ? 150 : 130} />
          </View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
        }}
        ListEmptyComponent={
          query.isPending ? (
            <SkeletonGroup>
              <SkeletonCard />
              <SkeletonCard />
            </SkeletonGroup>
          ) : query.isError ? (
            <ErrorState kind="offline" message={t('tips.unavailable')} onRetry={() => void query.refetch()} />
          ) : (
            <EmptyState icon="search" title={t('tips.none')} message={t('tips.none.body')} />
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel={t('tips.loadingMore')} style={{ marginTop: space[4] }} />
          ) : null
        }
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  headerWrap: { width: '100%', maxWidth: layout.maxContentWidth + 2 * layout.gutterTablet, alignSelf: 'center' },
  content: { width: '100%', maxWidth: layout.maxContentWidth + 2 * layout.gutterTablet, alignSelf: 'center', paddingTop: space[2] },
  headerBlock: { gap: space[3], marginBottom: space[4] },
  gridCell: { flex: 1 },
}));
