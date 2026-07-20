/** Doctor directory (Phase 9): filters + rating-sorted list from the server. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { doctorSpecialtySchema, tzRegionSchema } from '@daktari/schemas';
import {
  Body,
  ChipRow,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
  Title,
} from '../../../src/components/ui';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/lib/errors';
import { formatTzs } from '../../../src/lib/money';
import { doctorApi, type DoctorListItem } from '../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

const SPECIALTIES = doctorSpecialtySchema.options;
const REGIONS = tzRegionSchema.options;

export default function DoctorDirectoryScreen(): React.JSX.Element {
  const t = useT();
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [nhifOnly, setNhifOnly] = useState(false);
  const [maxFee, setMaxFee] = useState('');

  const query = useQuery({
    queryKey: ['doctors', specialty, region, nhifOnly, maxFee],
    queryFn: () =>
      doctorApi.directory({
        ...(specialty !== null ? { specialization: specialty } : {}),
        ...(region !== null ? { region } : {}),
        ...(nhifOnly ? { acceptsNhif: true } : {}),
        ...(maxFee !== '' && Number(maxFee) > 0 ? { maxFee: Number(maxFee) } : {}),
      }),
  });

  return (
    <Screen>
      <Title>{t('doctors.title')}</Title>

      <Body muted>{t('doctors.filter.specialty')}</Body>
      <ChipRow
        options={[
          { value: '__any__', label: t('doctors.filter.any') },
          ...SPECIALTIES.map((value) => ({ value: value as string, label: value.replace(/_/g, ' ') })),
        ]}
        value={specialty ?? '__any__'}
        onChange={(value) => setSpecialty(value === '__any__' ? null : value)}
      />
      <Body muted>{t('doctors.filter.region')}</Body>
      <ChipRow
        options={[
          { value: '__any__', label: t('doctors.filter.any') },
          ...REGIONS.map((value) => ({ value: value as string, label: value.replace(/_/g, ' ') })),
        ]}
        value={region ?? '__any__'}
        onChange={(value) => setRegion(value === '__any__' ? null : value)}
      />
      <View style={styles.switchRow}>
        <Body>{t('doctors.filter.nhif')}</Body>
        <Switch value={nhifOnly} onValueChange={setNhifOnly} />
      </View>
      <TextField
        label={t('doctors.filter.maxFee')}
        value={maxFee}
        onChangeText={setMaxFee}
        keyboardType="number-pad"
      />

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          message={errorMessage(query.error, t('common.error.generic'))}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState message={t('doctors.none')} />
      ) : (
        query.data.items.map((doctor) => <DoctorCard key={doctor.id} doctor={doctor} />)
      )}
    </Screen>
  );
}

function DoctorCard({ doctor }: { doctor: DoctorListItem }): React.JSX.Element {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.card}
      onPress={() => router.push({ pathname: '/(patient)/doctors/[id]', params: { id: doctor.id } })}
    >
      <Text style={styles.cardName}>{doctor.fullName}</Text>
      <Text style={styles.cardMeta}>
        {doctor.specialty.replace(/_/g, ' ')}
        {doctor.subSpecialty !== null ? ` · ${doctor.subSpecialty}` : ''}
      </Text>
      <Text style={styles.cardMeta}>{t('doctors.experience', { years: String(doctor.yearsOfExperience) })}</Text>
      <View style={styles.cardFooter}>
        <Text style={styles.cardFee}>{formatTzs(doctor.consultationFeeTzs)}</Text>
        <Text style={styles.cardRating}>{`★ ${doctor.averageRating.toFixed(1)}`}</Text>
        <Text style={styles.cardMeta}>{doctor.languages.join(' / ').toUpperCase()}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardName: { ...typography.subtitle, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textMuted },
  cardFooter: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cardFee: { ...typography.body, color: colors.primaryDark, fontWeight: '700' },
  cardRating: { ...typography.body, color: colors.text },
});
