/** Doctor directory (Phase 9): filters + rating-sorted list from the server. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { router } from 'expo-router';
import { doctorSpecialtySchema, tzRegionSchema } from '@daktari/schemas';
import { useT } from '../../../src/i18n';
import { errorMessage } from '../../../src/lib/errors';
import { regionLabel, specialtyLabel } from '../../../src/lib/labels';
import { formatTzs } from '../../../src/lib/money';
import { doctorApi, type DoctorListItem } from '../../../src/services/endpoints';
import { space } from '../../../src/theme/theme';
import {
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  Header,
  Input,
  ListItem,
  Screen,
  SkeletonGroup,
  SkeletonListItem,
  SwitchRow,
  Text,
} from '../../../src/ui';

const SPECIALTIES = doctorSpecialtySchema.options;
const REGIONS = tzRegionSchema.options;

export default function DoctorDirectoryScreen(): React.JSX.Element {
  const t = useT();
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [nhifOnly, setNhifOnly] = useState(false);
  const [maxFee, setMaxFee] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  // Filters living in the sheet (specialty stays visible on the screen).
  const activeFilters = (region !== null ? 1 : 0) + (nhifOnly ? 1 : 0) + (maxFee !== '' ? 1 : 0);
  const clearFilters = (): void => {
    setRegion(null);
    setNhifOnly(false);
    setMaxFee('');
  };

  return (
    <Screen
      header={
        <Header
          title={t('doctors.title')}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/(patient)/home'))}
        />
      }
    >
      <View style={{ gap: space[3] }}>
        <Text variant="label">{t('doctors.filter.specialty')}</Text>
        <ChipGroup
          scroll
          options={[
            { value: '__any__', label: t('doctors.filter.any') },
            ...SPECIALTIES.map((value) => ({ value: value as string, label: specialtyLabel(t, value) })),
          ]}
          value={specialty ?? '__any__'}
          onChange={(value) => setSpecialty(value === '__any__' ? null : value)}
        />
        <Button
          variant="secondary"
          size="sm"
          icon="sliders"
          fullWidth={false}
          label={activeFilters > 0 ? `${t('doctors.filters')} (${activeFilters})` : t('doctors.filters')}
          onPress={() => setFiltersOpen(true)}
        />
      </View>

      {query.isPending ? (
        <Card>
          <SkeletonGroup>
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </SkeletonGroup>
        </Card>
      ) : query.isError ? (
        <Card>
          <ErrorState
            message={errorMessage(query.error, t('common.error.generic'))}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.data.items.length === 0 ? (
        <Card>
          <EmptyState
            icon="search"
            title={t('doctors.none')}
            {...(activeFilters > 0 || specialty !== null
              ? {
                  action: {
                    label: t('doctors.filters.clear'),
                    icon: 'x' as const,
                    onPress: () => {
                      clearFilters();
                      setSpecialty(null);
                    },
                  },
                }
              : {})}
          />
        </Card>
      ) : (
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {query.data.items.map((doctor, index) => (
            <DoctorRow key={doctor.id} doctor={doctor} divider={index < query.data.items.length - 1} />
          ))}
        </Card>
      )}

      <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('doctors.filters')}>
        <Text variant="label">{t('doctors.filter.region')}</Text>
        <ChipGroup
          options={[
            { value: '__any__', label: t('doctors.filter.any') },
            ...REGIONS.map((value) => ({ value: value as string, label: regionLabel(value) })),
          ]}
          value={region ?? '__any__'}
          onChange={(value) => setRegion(value === '__any__' ? null : value)}
        />
        <SwitchRow label={t('doctors.filter.nhif')} value={nhifOnly} onChange={setNhifOnly} />
        <Input
          label={t('doctors.filter.maxFee')}
          leadingIcon="credit-card"
          value={maxFee}
          onChangeText={setMaxFee}
          keyboardType="number-pad"
        />
        <Button label={t('doctors.filters.apply')} icon="check" onPress={() => setFiltersOpen(false)} />
        {activeFilters > 0 ? (
          <Button variant="ghost" label={t('doctors.filters.clear')} onPress={clearFilters} />
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

function DoctorRow({ doctor, divider }: { doctor: DoctorListItem; divider: boolean }): React.JSX.Element {
  const t = useT();
  const languages = doctor.languages
    .map((code) => (code === 'sw' ? t('profile.language.sw') : code === 'en' ? t('profile.language.en') : code))
    .join(' / ');
  return (
    <ListItem
      title={doctor.fullName}
      subtitle={`${specialtyLabel(t, doctor.specialty)}${doctor.subSpecialty !== null ? ` · ${doctor.subSpecialty}` : ''}`}
      leading={<Avatar name={doctor.fullName} />}
      meta={
        <>
          <Text variant="bodyStrong" tone="primary">
            {formatTzs(doctor.consultationFeeTzs)}
          </Text>
          <Badge tone="neutral" icon="star" label={doctor.averageRating.toFixed(1)} />
          {doctor.acceptsNhif ? <Badge tone="success" icon="shield" label={t('doctors.nhifBadge')} /> : null}
          <Text variant="caption" tone="secondary">
            {`${t('doctors.experience', { years: String(doctor.yearsOfExperience) })} · ${languages}`}
          </Text>
        </>
      }
      onPress={() => router.push({ pathname: '/(patient)/doctors/[id]', params: { id: doctor.id } })}
      divider={divider}
    />
  );
}
