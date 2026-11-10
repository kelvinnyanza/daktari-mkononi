import { regionFromAny, tzRegionSchema } from '@daktari/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useI18nStore, useT, type Locale } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { regionLabel } from '../../src/lib/labels';
import { clearTokens } from '../../src/services/api';
import { patientApi } from '../../src/services/endpoints';
import { useAuthStore } from '../../src/stores/auth';
import { DevStylePreviewEntry } from '../../src/components/dev-style-preview-entry';
import { space, useTheme } from '../../src/theme/theme';
import {
  Banner,
  Button,
  Card,
  ChipGroup,
  ErrorState,
  Header,
  Icon,
  Input,
  Screen,
  SkeletonCard,
  SkeletonGroup,
  Text,
  type IconName,
} from '../../src/ui';

const SEX_KEY = {
  MALE: 'health.sex.male',
  FEMALE: 'health.sex.female',
  UNDISCLOSED: 'health.sex.undisclosed',
} as const;

/** The 31-region enum straight from @daktari/schemas — one source of truth. */
const REGION_OPTIONS = tzRegionSchema.options.map((region) => ({
  value: region,
  label: regionLabel(region),
}));

export default function Profile(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, setLocale } = useI18nStore();
  const signOut = useAuthStore((state) => state.signOut);

  const query = useQuery({ queryKey: ['profile', 'me'], queryFn: () => patientApi.myProfile() });
  const health = useQuery({ queryKey: ['health-profile', 'me'], queryFn: () => patientApi.healthProfile() });

  const [editing, setEditing] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  const [district, setDistrict] = useState('');
  const [ward, setWard] = useState('');
  const [street, setStreet] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const startEditing = (): void => {
    const profile = query.data;
    if (!profile) return;
    // Stored as a code; older rows hold the display name ('Mwanza') — both preselect.
    setRegion(regionFromAny(profile.region));
    setDistrict(profile.district === 'UNKNOWN' ? '' : profile.district);
    setWard(profile.ward ?? '');
    setStreet(profile.street ?? '');
    setContactName(profile.emergencyContact?.name ?? '');
    setContactPhone(profile.emergencyContact?.phone ?? '');
    setContactRelationship(profile.emergencyContact?.relationship ?? '');
    setEditing(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (region !== null) body.region = region;
      if (district.trim().length > 0) body.district = district.trim();
      if (ward.trim().length > 0) body.ward = ward.trim();
      if (street.trim().length > 0) body.street = street.trim();
      if (contactName && contactPhone && contactRelationship) {
        body.emergencyContact = {
          name: contactName.trim(),
          phone: contactPhone.trim(),
          relationship: contactRelationship.trim(),
        };
      }
      body.language = locale; // server keeps User.language in sync
      return patientApi.updateProfile(body);
    },
    onSuccess: async () => {
      setFormError(null);
      setNotice(t('profile.saved'));
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const switchLocale = (next: Locale): void => {
    setLocale(next); // whole-app live switch
  };

  return (
    <Screen header={<Header title={t('profile.title')} large />}>
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('profile.language')}
        </Text>
        <ChipGroup
          options={[
            { value: 'sw', label: t('profile.language.sw') },
            { value: 'en', label: t('profile.language.en') },
          ]}
          value={locale}
          onChange={switchLocale}
        />
      </Card>

      {query.isPending ? (
        <SkeletonGroup>
          <SkeletonCard />
        </SkeletonGroup>
      ) : query.isError ? (
        <Card>
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </Card>
      ) : !editing ? (
        <Card>
          <ProfileRow icon="map" label={t('profile.region')} value={regionLabel(query.data.region)} />
          <ProfileRow icon="map-pin" label={t('profile.district')} value={query.data.district} />
          {query.data.emergencyContact !== null ? (
            <ProfileRow
              icon="phone-call"
              label={t('profile.emergencyContact')}
              value={`${query.data.emergencyContact.name} · ${query.data.emergencyContact.phone}`}
            />
          ) : null}
          {notice !== null ? <Banner tone="success" message={notice} /> : null}
          <Button variant="secondary" icon="edit-2" label={t('profile.edit')} onPress={startEditing} />
        </Card>
      ) : (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            {t('profile.edit')}
          </Text>
          <Text variant="label">{t('profile.region')}</Text>
          <ChipGroup options={REGION_OPTIONS} value={region} onChange={setRegion} />
          <Input label={t('profile.district')} value={district} onChangeText={setDistrict} />
          <Input label={t('profile.ward')} value={ward} onChangeText={setWard} />
          <Input label={t('profile.street')} value={street} onChangeText={setStreet} />
          <Text variant="heading" accessibilityRole="header">
            {t('profile.emergencyContact')}
          </Text>
          <Input
            label={t('profile.emergencyContact.name')}
            leadingIcon="user"
            value={contactName}
            onChangeText={setContactName}
          />
          <Input
            label={t('profile.emergencyContact.phone')}
            leadingIcon="phone"
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
          />
          <Input
            label={t('profile.emergencyContact.relationship')}
            leadingIcon="users"
            value={contactRelationship}
            onChangeText={setContactRelationship}
          />
          {formError !== null ? <Banner tone="danger" message={formError} /> : null}
          <Button icon="check" label={t('common.save')} onPress={() => save.mutate()} loading={save.isPending} />
          <Button variant="ghost" label={t('common.cancel')} onPress={() => setEditing(false)} />
        </Card>
      )}

      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('health.editTitle')}
        </Text>
        {health.isPending ? (
          <SkeletonGroup>
            <SkeletonCard />
          </SkeletonGroup>
        ) : health.isError ? (
          <ErrorState message={errorMessage(health.error)} onRetry={() => void health.refetch()} />
        ) : health.data.completed ? (
          <>
            {health.data.age !== null ? (
              <ProfileRow icon="calendar" label={t('health.dob')} value={t('health.age', { years: health.data.age })} />
            ) : null}
            {health.data.sex !== null ? (
              <ProfileRow icon="user" label={t('health.sex')} value={t(SEX_KEY[health.data.sex])} />
            ) : null}
            {health.data.heightCm !== null && health.data.weightKg !== null ? (
              <ProfileRow
                icon="activity"
                label={`${t('health.height')} · ${t('health.weight')}`}
                value={`${health.data.heightCm} cm · ${health.data.weightKg} kg`}
              />
            ) : null}
          </>
        ) : (
          <Text tone="secondary">{t('health.summary.none')}</Text>
        )}
        <Button
          variant="secondary"
          icon="clipboard"
          label={health.data?.completed === true ? t('health.summary.edit') : t('health.summary.fill')}
          onPress={() => router.push('/(patient)/health-profile')}
        />
      </Card>

      <Button
        variant="secondary"
        icon="log-out"
        label={t('auth.logout')}
        onPress={() => {
          void clearTokens().then(() => {
            signOut();
            router.replace('/(auth)/login');
          });
        }}
      />
      <DevStylePreviewEntry />
    </Screen>
  );
}

function ProfileRow({ icon, label, value }: { icon: IconName; label: string; value: string }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
      <Icon name={icon} size={20} color={colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
        <Text variant="bodyStrong">{value}</Text>
      </View>
    </View>
  );
}
