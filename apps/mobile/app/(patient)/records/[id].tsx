/**
 * Medical record detail (Phase 9): decrypted summary + clinical sections,
 * diagnoses (ICD codes styled secondary), addendum chain, and an explicit
 * "no medications" prescriptions section (domain lands Phase 11+).
 */
import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Body, ErrorState, LoadingState, Screen, Title } from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { eatDateTimeLabel } from '../../../src/lib/datetime';
import { errorMessage } from '../../../src/lib/errors';
import { recordsApi } from '../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

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

  if (query.isPending) return <LoadingState />;
  if (query.isError) {
    return (
      <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  }
  const record = query.data;
  const notes = record.content.notes ?? {};

  return (
    <Screen>
      <Title>{record.title}</Title>
      <Body muted>{eatDateTimeLabel(record.createdAt)}</Body>

      {record.addendumToId !== null && original.data !== undefined ? (
        <View style={styles.addendum}>
          <Body muted>
            {t('records.addendum', { date: eatDateTimeLabel(original.data.createdAt) })}
          </Body>
        </View>
      ) : null}

      {record.summary !== null ? (
        <Section title={t('records.section.summary')}>
          <Body>{record.summary}</Body>
        </Section>
      ) : null}

      <Section title={t('records.section.notes')}>
        {NOTE_SECTIONS.map(([field, key]) =>
          notes[field] !== undefined ? (
            <View key={field} style={styles.noteBlock}>
              <Text style={styles.noteLabel}>{t(key)}</Text>
              <Body>{notes[field]}</Body>
            </View>
          ) : null,
        )}
      </Section>

      {record.content.diagnoses !== undefined && record.content.diagnoses.length > 0 ? (
        <Section title={t('records.section.diagnoses')}>
          {record.content.diagnoses.map((diagnosis, index) => (
            <View key={index} style={styles.diagnosisRow}>
              <Body>{diagnosis.description}</Body>
              <Text style={styles.icdCode}>{diagnosis.icd10Code}</Text>
            </View>
          ))}
        </Section>
      ) : null}

      <Section title={t('records.section.prescriptions')}>
        <Body muted>{t('records.prescriptions.none')}</Body>
      </Section>
    </Screen>
  );
}

function Section({ title, children }: React.PropsWithChildren<{ title: string }>): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { ...typography.subtitle, color: colors.text },
  noteBlock: { gap: spacing.xs },
  noteLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  diagnosisRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  icdCode: { ...typography.caption, color: colors.textMuted },
  addendum: {
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.sm,
  },
});
