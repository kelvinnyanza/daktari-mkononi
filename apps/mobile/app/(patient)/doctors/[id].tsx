/**
 * Doctor detail + the full booking flow (Phase 9):
 * date strip → slot grid (EAT) → type → reason → payment intent → confirm.
 * The server re-validates everything; SLOT_TAKEN refreshes the grid.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  availableIntents,
  availableTypes,
  type AppointmentType,
  type PaymentIntent,
} from '../../../src/features/booking/intents';
import { useT } from '../../../src/i18n';
import { buildDateStrip } from '../../../src/lib/datetime';
import { errorMessage, isApiError } from '../../../src/lib/errors';
import { specialtyLabel } from '../../../src/lib/labels';
import { formatTzs } from '../../../src/lib/money';
import { appointmentApi, doctorApi, patientApi } from '../../../src/services/endpoints';
import { space } from '../../../src/theme/theme';
import {
  Avatar,
  Badge,
  Banner,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  Header,
  Input,
  Screen,
  Section,
  SkeletonCard,
  SkeletonGroup,
  Skeleton,
  Text,
} from '../../../src/ui';

export default function DoctorDetailScreen(): React.JSX.Element {
  const t = useT();
  const params = useLocalSearchParams<{ id: string; screeningResultId?: string }>();
  const doctorId = params.id;
  const queryClient = useQueryClient();

  const dateStrip = useMemo(() => buildDateStrip(new Date(), 7), []);
  const [date, setDate] = useState(dateStrip[0]!.date);
  const [slot, setSlot] = useState<string | null>(null); // startUtc ISO
  const [type, setType] = useState<AppointmentType>('VIDEO');
  const [reason, setReason] = useState('');
  const [intent, setIntent] = useState<PaymentIntent>('MOBILE_MONEY');
  const [slotTaken, setSlotTaken] = useState(false);

  const doctor = useQuery({ queryKey: ['doctor', doctorId], queryFn: () => doctorApi.detail(doctorId) });
  const profile = useQuery({ queryKey: ['profile', 'me'], queryFn: () => patientApi.myProfile() });
  const availability = useQuery({
    queryKey: ['availability', doctorId, date],
    queryFn: () => doctorApi.availability(doctorId, date),
  });

  const reasonValid = reason.trim().length >= 10;

  const book = useMutation({
    mutationFn: () =>
      appointmentApi.book({
        doctorId,
        type,
        scheduledAt: slot!,
        reason: reason.trim(),
        paymentIntent: intent,
        ...(params.screeningResultId !== undefined
          ? { screeningResultId: params.screeningResultId }
          : {}),
      }),
    onSuccess: async (appointment) => {
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
      router.replace({ pathname: '/(patient)/appointments/[id]', params: { id: appointment.id } });
    },
    onError: async (error) => {
      if (isApiError(error) && error.code === 'SLOT_TAKEN') {
        setSlotTaken(true);
        setSlot(null);
        await availability.refetch(); // refreshed grid
      }
    },
  });

  const header = (
    <Header
      title={t('booking.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/(patient)/doctors'))}
    />
  );

  if (doctor.isPending) {
    return (
      <Screen header={header}>
        <SkeletonGroup>
          <SkeletonCard />
          <SkeletonCard />
        </SkeletonGroup>
      </Screen>
    );
  }
  if (doctor.isError) {
    return (
      <Screen header={header}>
        <ErrorState
          message={errorMessage(doctor.error, t('common.error.generic'))}
          onRetry={() => void doctor.refetch()}
        />
      </Screen>
    );
  }

  const verifiedNhif = profile.data?.insurance?.verifiedNhif === true;
  const types = availableTypes(doctor.data);
  const intents = availableIntents({ type, verifiedNhif });
  if (!types.includes(type)) setType('VIDEO');
  if (!intents.includes(intent)) setIntent('MOBILE_MONEY');

  const selectedSlot = availability.data?.slots.find((s) => s.startUtc === slot);

  return (
    <Screen header={header}>
      <Card>
        <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
          <Avatar name={doctor.data.fullName} size="lg" />
          <View style={{ flex: 1, gap: space[1] }}>
            <Text variant="heading">{doctor.data.fullName}</Text>
            <Text variant="caption" tone="secondary">
              {specialtyLabel(t, doctor.data.specialty)}
              {doctor.data.subSpecialty !== null ? ` · ${doctor.data.subSpecialty}` : ''}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <Badge tone="neutral" icon="star" label={doctor.data.averageRating.toFixed(1)} />
              {doctor.data.acceptsNhif ? <Badge tone="success" icon="shield" label={t('doctors.nhifBadge')} /> : null}
            </View>
          </View>
        </View>
        <Text variant="bodyStrong" tone="primary">
          {formatTzs(doctor.data.consultationFeeTzs)}
        </Text>
        <Text variant="caption" tone="secondary">
          {t('doctors.experience', { years: String(doctor.data.yearsOfExperience) })}
        </Text>
        {doctor.data.bio !== null ? <Text>{doctor.data.bio}</Text> : null}
      </Card>

      {/* Date strip: next 7 EAT days */}
      <Section
        title={
          <Text variant="heading" accessibilityRole="header">
            {t('doctors.detail.availability')}
          </Text>
        }
      >
        <ChipGroup
          scroll
          options={dateStrip.map((day) => ({
            value: day.date,
            label: `${t(`weekday.${day.weekday}` as never)} ${day.dayOfMonth}`,
          }))}
          value={date}
          onChange={(value) => {
            setDate(value);
            setSlot(null);
            setSlotTaken(false);
          }}
        />

        {availability.isPending ? (
          <SkeletonGroup>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              <Skeleton width={88} height={48} rounded={24} />
              <Skeleton width={88} height={48} rounded={24} />
              <Skeleton width={88} height={48} rounded={24} />
            </View>
          </SkeletonGroup>
        ) : availability.isError ? (
          <ErrorState
            message={errorMessage(availability.error, t('common.error.generic'))}
            onRetry={() => void availability.refetch()}
          />
        ) : availability.data.slots.length === 0 ? (
          <Card tone="muted">
            <EmptyState icon="calendar" title={t('doctors.detail.noSlots')} />
          </Card>
        ) : (
          <ChipGroup
            options={availability.data.slots.map((entry) => ({ value: entry.startUtc, label: entry.startEat }))}
            value={slot}
            onChange={(value) => {
              setSlot(value);
              setSlotTaken(false);
            }}
          />
        )}
        {slotTaken ? <Banner tone="warning" message={t('booking.slotTaken')} /> : null}
      </Section>

      {slot !== null ? (
        <Card>
          <Text variant="heading" accessibilityRole="header">
            {t('booking.title')}
          </Text>
          <Badge
            tone="primary"
            icon="clock"
            label={t('booking.slot', { time: `${date} ${selectedSlot?.startEat ?? ''}` })}
          />

          <Text variant="label">{t('booking.type')}</Text>
          <ChipGroup
            options={types.map((value) => ({ value, label: t(`booking.type.${value}` as never) }))}
            value={type}
            onChange={setType}
          />

          <Input
            label={t('booking.reason')}
            value={reason}
            onChangeText={setReason}
            multiline
            error={reason.length > 0 && !reasonValid ? t('booking.reason.error') : undefined}
          />

          <Text variant="label">{t('booking.intent.title')}</Text>
          <ChipGroup
            options={intents.map((value) => ({ value, label: t(`booking.intent.${value}` as never) }))}
            value={intent}
            onChange={setIntent}
          />

          {book.isError && !(isApiError(book.error) && book.error.code === 'SLOT_TAKEN') ? (
            <Banner tone="danger" message={errorMessage(book.error, t('common.error.generic'))} />
          ) : null}

          <Button
            label={t('booking.confirm')}
            icon="check"
            onPress={() => book.mutate()}
            loading={book.isPending}
            disabled={!reasonValid}
          />
        </Card>
      ) : null}
    </Screen>
  );
}
