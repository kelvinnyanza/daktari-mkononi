import { tzRegionSchema } from '@daktari/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Body,
  Button,
  ChipRow,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
  Title,
} from '../../src/components/ui';
import { useI18nStore, useT, type Locale } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { clearTokens } from '../../src/services/api';
import { patientApi } from '../../src/services/endpoints';
import { useAuthStore } from '../../src/stores/auth';

/** The 31-region enum straight from @daktari/schemas — one source of truth. */
const REGION_OPTIONS = tzRegionSchema.options.map((region) => ({
  value: region,
  label: region.replaceAll('_', ' '),
}));

export default function Profile(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, setLocale } = useI18nStore();
  const signOut = useAuthStore((state) => state.signOut);

  const query = useQuery({ queryKey: ['profile', 'me'], queryFn: () => patientApi.myProfile() });

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
    setRegion(profile.region === 'UNKNOWN' ? null : profile.region);
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
    <Screen>
      <Title>{t('profile.title')}</Title>

      <Body muted>{t('profile.language')}</Body>
      <ChipRow
        options={[
          { value: 'sw', label: t('profile.language.sw') },
          { value: 'en', label: t('profile.language.en') },
        ]}
        value={locale}
        onChange={switchLocale}
      />

      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : !editing ? (
        <>
          <Body muted>{t('profile.region')}</Body>
          <Body>{query.data.region.replaceAll('_', ' ')}</Body>
          <Body muted>{t('profile.district')}</Body>
          <Body>{query.data.district}</Body>
          {query.data.emergencyContact !== null ? (
            <>
              <Body muted>{t('profile.emergencyContact')}</Body>
              <Body>
                {query.data.emergencyContact.name} · {query.data.emergencyContact.phone}
              </Body>
            </>
          ) : null}
          {notice !== null ? <Body muted>{notice}</Body> : null}
          <Button label={t('profile.edit')} onPress={startEditing} />
        </>
      ) : (
        <>
          <Body muted>{t('profile.region')}</Body>
          <ChipRow options={REGION_OPTIONS} value={region} onChange={setRegion} />
          <TextField label={t('profile.district')} value={district} onChangeText={setDistrict} error={undefined} />
          <TextField label={t('profile.ward')} value={ward} onChangeText={setWard} error={undefined} />
          <TextField label={t('profile.street')} value={street} onChangeText={setStreet} error={undefined} />
          <Body muted>{t('profile.emergencyContact')}</Body>
          <TextField
            label={t('profile.emergencyContact.name')}
            value={contactName}
            onChangeText={setContactName}
            error={undefined}
          />
          <TextField
            label={t('profile.emergencyContact.phone')}
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
            error={undefined}
          />
          <TextField
            label={t('profile.emergencyContact.relationship')}
            value={contactRelationship}
            onChangeText={setContactRelationship}
            error={undefined}
          />
          {formError !== null ? <Body>{formError}</Body> : null}
          <Button label={t('common.save')} onPress={() => save.mutate()} disabled={save.isPending} />
          <Button label={t('common.cancel')} onPress={() => setEditing(false)} />
        </>
      )}

      <Button
        destructive
        label={t('auth.logout')}
        onPress={() => {
          void clearTokens().then(() => {
            signOut();
            router.replace('/(auth)/login');
          });
        }}
      />
    </Screen>
  );
}
