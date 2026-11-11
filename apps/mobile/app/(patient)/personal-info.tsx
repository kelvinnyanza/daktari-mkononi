/**
 * Profile → Taarifa binafsi: address and emergency contact (the existing
 * PATCH /patients/me/profile — same fields and rules as before UI Phase 3,
 * moved off the Profile screen into its own page).
 */
import { regionFromAny, tzRegionSchema } from '@daktari/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useI18nStore, useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import { regionLabel } from '../../src/lib/labels';
import { fromE164, toE164 } from '../../src/lib/phone';
import { patientApi } from '../../src/services/endpoints';
import {
  Banner,
  Button,
  Card,
  ErrorState,
  Header,
  Input,
  PhoneInput,
  Screen,
  SelectField,
  SkeletonCard,
  SkeletonGroup,
  Text,
} from '../../src/ui';

const REGION_OPTIONS = tzRegionSchema.options.map((region) => ({ value: region, label: regionLabel(region) }));

export default function PersonalInfo(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useI18nStore((state) => state.locale);
  const query = useQuery({ queryKey: ['profile', 'me'], queryFn: () => patientApi.myProfile() });

  const [region, setRegion] = useState<string | null>(null);
  const [district, setDistrict] = useState('');
  const [ward, setWard] = useState('');
  const [street, setStreet] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const initialised = useRef(false);

  useEffect(() => {
    const profile = query.data;
    if (profile === undefined || initialised.current) return;
    initialised.current = true;
    // Stored as a code; older rows hold the display name ('Mwanza') — both preselect.
    setRegion(regionFromAny(profile.region));
    setDistrict(profile.district === 'UNKNOWN' ? '' : profile.district);
    setWard(profile.ward ?? '');
    setStreet(profile.street ?? '');
    setContactName(profile.emergencyContact?.name ?? '');
    setContactPhone(fromE164(profile.emergencyContact?.phone));
    setContactRelationship(profile.emergencyContact?.relationship ?? '');
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (region !== null) body.region = region;
      if (district.trim().length > 0) body.district = district.trim();
      if (ward.trim().length > 0) body.ward = ward.trim();
      if (street.trim().length > 0) body.street = street.trim();
      if (contactName.trim() !== '' && contactPhone !== '' && contactRelationship.trim() !== '') {
        body.emergencyContact = {
          name: contactName.trim(),
          phone: toE164(contactPhone),
          relationship: contactRelationship.trim(),
        };
      }
      body.language = locale; // server keeps User.language in sync
      return patientApi.updateProfile(body);
    },
    onSuccess: async () => {
      setFormError(null);
      setNotice(t('profile.saved'));
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/(patient)/profile'));

  return (
    <Screen header={<Header title={t('personal.title')} onBack={back} />}>
      {query.isPending ? (
        <SkeletonGroup>
          <SkeletonCard />
          <SkeletonCard />
        </SkeletonGroup>
      ) : query.isError ? (
        <Card>
          <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
        </Card>
      ) : (
        <>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('health.section.home')}
            </Text>
            <SelectField
              label={t('profile.region')}
              leadingIcon="map"
              value={region}
              options={REGION_OPTIONS}
              onChange={setRegion}
              placeholder={t('health.region.placeholder')}
            />
            <Input label={t('profile.district')} leadingIcon="map-pin" value={district} onChangeText={setDistrict} />
            <Input label={t('profile.ward')} value={ward} onChangeText={setWard} />
            <Input label={t('profile.street')} value={street} onChangeText={setStreet} />
          </Card>
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('profile.emergencyContact')}
            </Text>
            <Input label={t('profile.emergencyContact.name')} leadingIcon="user" value={contactName} onChangeText={setContactName} />
            <PhoneInput label={t('profile.emergencyContact.phone')} value={contactPhone} onChangeDigits={setContactPhone} />
            <Input
              label={t('profile.emergencyContact.relationship')}
              leadingIcon="users"
              value={contactRelationship}
              onChangeText={setContactRelationship}
            />
          </Card>
          {formError !== null ? <Banner tone="danger" message={formError} /> : null}
          {notice !== null ? <Banner tone="success" message={notice} /> : null}
          <Button icon="check" label={t('common.save')} onPress={() => save.mutate()} loading={save.isPending} />
        </>
      )}
    </Screen>
  );
}
