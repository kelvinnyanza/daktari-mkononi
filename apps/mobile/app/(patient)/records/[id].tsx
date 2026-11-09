/**
 * Medical record detail (Phase 9): decrypted summary + clinical sections,
 * diagnoses (ICD codes styled secondary), addendum chain, and an explicit
 * "no medications" prescriptions section (domain lands Phase 11+).
 */
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useT } from '../../../src/i18n';
import { eatDateTimeLabel } from '../../../src/lib/datetime';
import { errorMessage } from '../../../src/lib/errors';
import { recordsApi } from '../../../src/services/endpoints';
import { space } from '../../../src/theme/theme';
import {
  Badge,
  Banner,
  Card,
  ErrorState,
  Header,
  Screen,
  SkeletonCard,
  SkeletonGroup,
  Text,
} from '../../../src/ui';

const NOTE_SECTIONS = [
  ['chiefComplaint', 'records.section.chiefComplaint'],
  ['historyOfPresentIllness', 'records.section.hpi'],
  ['examination', 'records.section.examination'],
  ['assessment', 'records.section.assessment'],
  ['plan', 'records.section.plan'],
] as const;

export default function RecordDetail(): React.JSX.Element {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['records', id],
    queryFn: () => recordsApi.detail(id ?? ''),
    enabled: id !== undefined,
  });
  // Addendum chain: fetch the original record's metadata for its date.
  const original = useQuery({
    queryKey: ['records', query.data?.addendumToId],
    queryFn: () => recordsApi.detail(query.data!.addendumToId!),
    enabled: query.data?.addendumToId != null,
  });

  const header = (
    <Header
      title={t('records.detail.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(patient)/records'))}
    />
  );

  if (query.isPending) {
    return (
      <Screen header={header}>
        <SkeletonGroup>
          <SkeletonCard />
          <SkeletonCard />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (query.isError) {
    return (
      <Screen header={header}>
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </Screen>
    );
  }
  const record = query.data;
  const notes = record.content.notes ?? {};

  return (
    <Screen header={header}>
      <View style={{ gap: space[2] }}>
        <Text variant="title" accessibilityRole="header">
          {record.title}
        </Text>
        <Badge tone="neutral" icon="calendar" label={eatDateTimeLabel(record.createdAt)} />
      </View>

      {record.addendumToId !== null && original.data !== undefined ? (
        <Banner
          tone="info"
          icon="edit-3"
          message={t('records.addendum', { date: eatDateTimeLabel(original.data.createdAt) })}
        />
      ) : null}

      {record.summary !== null ? (
        <Card tone="primary">
          <Text variant="heading" accessibilityRole="header">
            {t('records.section.summary')}
          </Text>
          <Text>{record.summary}</Text>
        </Card>
      ) : null}

      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('records.section.notes')}
        </Text>
        {NOTE_SECTIONS.map(([field, key]) =>
          notes[field] !== undefined ? (
            <View key={field} style={{ gap: space[1] }}>
              <Text variant="label" tone="secondary">
                {t(key)}
              </Text>
              <Text>{notes[field]}</Text>
            </View>
          ) : null,
        )}
      </Card>

      {record.content.diagnoses !== undefined && record.content.diagnoses.length > 0 ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            {t('records.section.diagnoses')}
          </Text>
          {record.content.diagnoses.map((diagnosis, index) => (
            <View key={index} style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
              <Text style={{ flex: 1 }}>{diagnosis.description}</Text>
              <Badge tone="neutral" label={diagnosis.icd10Code} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card tone="muted">
        <Text variant="heading" accessibilityRole="header">
          {t('records.section.prescriptions')}
        </Text>
        <Text tone="secondary">{t('records.prescriptions.none')}</Text>
      </Card>
    </Screen>
  );
}
