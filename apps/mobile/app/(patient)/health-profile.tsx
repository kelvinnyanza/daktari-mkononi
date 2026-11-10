/**
 * Health profile (UI Phase 2) — "Tukufahamu zaidi".
 *
 * Reached right after registration + OTP + first login (`?onboarding=1`: no
 * back arrow, "Baadaye" goes Home), and from Profile / the Home card for
 * editing. Validates with the server's own schema (18+, ranges, consent);
 * the clinical fields are encrypted at rest by the API and only the doctor
 * treating the patient sees them. Nothing here is sent to the AI provider
 * except age band and sex (server-side rule).
 */
import {
  bloodTypeSchema,
  makeHealthProfileInputSchema,
  tzRegionSchema,
  type BloodGroupAnswer,
  type BpHistory,
} from '@daktari/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/lib/errors';
import {
  ageFromParts,
  EMPTY_HEALTH_FORM,
  errorKey,
  fieldOf,
  formFromView,
  toHealthInput,
  type HealthField,
  type HealthFormState,
  type Sex,
} from '../../src/lib/health-profile';
import { bloodTypeLabel, regionLabel } from '../../src/lib/labels';
import { patientApi } from '../../src/services/endpoints';
import { useEmergencyFabLift } from '../../src/ui/emergency-fab-lift';
import { space } from '../../src/theme/theme';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  ChipGroup,
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
const BLOOD_OPTIONS = bloodTypeSchema.options.map((value) => ({ value, label: bloodTypeLabel(value) }));

export default function HealthProfileScreen(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ onboarding?: string }>();
  const onboarding = params.onboarding === '1';

  const query = useQuery({ queryKey: ['health-profile', 'me'], queryFn: () => patientApi.healthProfile() });
  const [form, setForm] = useState<HealthFormState>(EMPTY_HEALTH_FORM);
  const [errors, setErrors] = useState<Partial<Record<HealthField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const initialised = useRef(false);
  // Keep the "Dharura" button above the sticky Hifadhi / Baadaye footer.
  const [footerHeight, setFooterHeight] = useState(0);
  useEmergencyFabLift(footerHeight);

  useEffect(() => {
    if (query.data !== undefined && !initialised.current) {
      initialised.current = true;
      setForm(formFromView(query.data));
    }
  }, [query.data]);

  const set = <K extends keyof HealthFormState>(field: K, value: HealthFormState[K]): void =>
    setForm((current) => ({ ...current, [field]: value }));

  const goHome = (): void => router.replace('/(patient)/home');
  const back = (): void => (router.canGoBack() ? router.back() : goHome());

  const save = useMutation({
    mutationFn: (body: Parameters<typeof patientApi.saveHealthProfile>[0]) => patientApi.saveHealthProfile(body),
    onSuccess: async (view) => {
      queryClient.setQueryData(['health-profile', 'me'], view);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      if (onboarding) goHome();
      else back();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const submit = (): void => {
    setFormError(null);
    const body = toHealthInput(form);
    // The server's schema, so the app and the API agree on every rule.
    const parsed = makeHealthProfileInputSchema().safeParse(body);
    if (!parsed.success) {
      const next: Partial<Record<HealthField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = fieldOf(String(issue.path[0] ?? ''));
        next[field] ??= t(errorKey(field, issue.message));
      }
      setErrors(next);
      setFormError(t('health.errorSummary'));
      return;
    }
    setErrors({});
    save.mutate(body as Parameters<typeof patientApi.saveHealthProfile>[0]);
  };

  const age = ageFromParts(form.day, form.month, form.year, new Date());

  const footer = (
    <>
      {formError !== null ? <Banner tone="danger" message={formError} /> : null}
      <Button label={t('health.save')} icon="check" onPress={submit} loading={save.isPending} testID="health-save" />
      {onboarding ? <Button variant="ghost" label={t('health.later')} onPress={goHome} testID="health-later" /> : null}
    </>
  );

  return (
    <Screen
      header={
        <Header
          title={onboarding ? t('health.title') : t('health.editTitle')}
          large={onboarding}
          {...(onboarding ? {} : { onBack: back })}
        />
      }
      footer={query.isSuccess ? footer : undefined}
      onFooterLayout={setFooterHeight}
    >
      <Text tone="secondary">{t('health.intro')}</Text>

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
              {t('health.section.about')}
            </Text>
            <View style={{ gap: space[2] }}>
              <Text variant="label">{t('health.dob')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                <View style={{ flex: 1, minWidth: 84 }}>
                  <Input
                    label={t('health.dob.day')}
                    value={form.day}
                    onChangeText={(text) => set('day', text.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    placeholder="12"
                    testID="health-dob-day"
                  />
                </View>
                <View style={{ flex: 1, minWidth: 84 }}>
                  <Input
                    label={t('health.dob.month')}
                    value={form.month}
                    onChangeText={(text) => set('month', text.replace(/\D/g, '').slice(0, 2))}
                    keyboardType="number-pad"
                    placeholder="4"
                    testID="health-dob-month"
                  />
                </View>
                <View style={{ flex: 1.4, minWidth: 104 }}>
                  <Input
                    label={t('health.dob.year')}
                    value={form.year}
                    onChangeText={(text) => set('year', text.replace(/\D/g, '').slice(0, 4))}
                    keyboardType="number-pad"
                    placeholder="1990"
                    testID="health-dob-year"
                  />
                </View>
              </View>
              {errors.dateOfBirth !== undefined ? (
                <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                  {errors.dateOfBirth}
                </Text>
              ) : age !== null ? (
                // Calculated, never typed.
                <Text variant="bodyStrong" tone="primary" accessibilityLiveRegion="polite">
                  {t('health.age', { years: age })}
                </Text>
              ) : (
                <Text variant="caption" tone="secondary">
                  {t('health.dob.hint')}
                </Text>
              )}
            </View>

            <View style={{ gap: space[2] }}>
              <Text variant="label">{t('health.sex')}</Text>
              <ChipGroup<Sex>
                options={[
                  { value: 'FEMALE', label: t('health.sex.female') },
                  { value: 'MALE', label: t('health.sex.male') },
                  { value: 'UNDISCLOSED', label: t('health.sex.undisclosed') },
                ]}
                value={form.sex}
                onChange={(value) => set('sex', value)}
              />
              <FieldError message={errors.sex} />
            </View>
          </Card>

          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('health.section.body')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Input
                  label={t('health.height')}
                  leadingIcon="maximize-2"
                  value={form.height}
                  onChangeText={(text) => set('height', text)}
                  keyboardType="decimal-pad"
                  placeholder="165"
                  hint={t('health.height.hint')}
                  error={errors.heightCm}
                  testID="health-height"
                />
              </View>
              <View style={{ flex: 1, minWidth: 140 }}>
                <Input
                  label={t('health.weight')}
                  leadingIcon="activity"
                  value={form.weight}
                  onChangeText={(text) => set('weight', text)}
                  keyboardType="decimal-pad"
                  placeholder="62"
                  hint={t('health.weight.hint')}
                  error={errors.weightKg}
                  testID="health-weight"
                />
              </View>
            </View>
          </Card>

          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('health.section.home')}
            </Text>
            <SelectField
              label={t('health.region')}
              leadingIcon="map"
              value={form.region}
              options={REGION_OPTIONS}
              onChange={(value) => set('region', value)}
              placeholder={t('health.region.placeholder')}
              error={errors.region}
              testID="health-region"
            />
            <Input
              label={t('health.district')}
              leadingIcon="map-pin"
              value={form.district}
              onChangeText={(text) => set('district', text)}
              autoCapitalize="words"
              error={errors.district}
              testID="health-district"
            />
          </Card>

          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('health.section.history')}
            </Text>
            <View style={{ gap: space[2] }}>
              <Text variant="label">{t('health.bp')}</Text>
              <ChipGroup<BpHistory>
                options={[
                  { value: 'NONE', label: t('health.bp.none') },
                  { value: 'YES_ON_MEDICATION', label: t('health.bp.treated') },
                  { value: 'YES_NO_MEDICATION', label: t('health.bp.untreated') },
                  { value: 'UNKNOWN', label: t('health.bp.unknown') },
                ]}
                value={form.bpHistory}
                onChange={(value) => set('bpHistory', value)}
              />
              <FieldError message={errors.bpHistory} />
            </View>
          </Card>

          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('health.section.optional')}
            </Text>
            <View style={{ gap: space[2] }}>
              <Text variant="label">{t('health.bloodGroup')}</Text>
              <ChipGroup<BloodGroupAnswer>
                options={[
                  ...BLOOD_OPTIONS,
                  { value: 'UNKNOWN' as const, label: t('health.bloodGroup.unknown') },
                ]}
                value={form.bloodGroup}
                onChange={(value) => set('bloodGroup', value)}
              />
            </View>
            {(
              [
                ['allergies', 'health.allergies'],
                ['chronicConditions', 'health.chronic'],
                ['currentMedications', 'health.medications'],
              ] as const
            ).map(([field, label]) => (
              <Input
                key={field}
                label={t(label)}
                value={form[field]}
                onChangeText={(text) => set(field, text)}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                hint={t('health.list.hint')}
                testID={`health-${field}`}
              />
            ))}
            <FieldError message={errors.lists} />
          </Card>

          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('health.section.contact')}
            </Text>
            <Input
              label={t('health.contact.name')}
              leadingIcon="user"
              value={form.contactName}
              onChangeText={(text) => set('contactName', text)}
              autoCapitalize="words"
            />
            <PhoneInput
              label={t('health.contact.phone')}
              value={form.contactPhone}
              onChangeDigits={(digits) => set('contactPhone', digits)}
              error={errors.emergencyContact}
            />
          </Card>

          <Checkbox
            checked={form.consent}
            onChange={(value) => set('consent', value)}
            label={t('health.consent')}
            error={errors.consent}
            testID="health-consent"
            below={
              <Button
                variant="ghost"
                size="sm"
                fullWidth={false}
                icon="shield"
                label={t('auth.consent.privacy')}
                onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
              />
            }
          />
        </>
      )}
    </Screen>
  );
}

function FieldError({ message }: { message: string | undefined }): React.JSX.Element | null {
  if (message === undefined) return null;
  return (
    <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
      {message}
    </Text>
  );
}
