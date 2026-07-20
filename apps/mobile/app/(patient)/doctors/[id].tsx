/**
 * Doctor detail + the full booking flow (Phase 9):
 * date strip → slot grid (EAT) → type → reason → payment intent → confirm.
 * The server re-validates everything; SLOT_TAKEN refreshes the grid.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Body,
  Button,
  ChipRow,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
  Title,
} from '../../../src/components/ui';
import {
  availableIntents,
  availableTypes,
  type AppointmentType,
  type PaymentIntent,
} from '../../../src/features/booking/intents';
import { useT } from '../../../src/i18n';
import { buildDateStrip } from '../../../src/lib/datetime';
import { errorMessage, isApiError } from '../../../src/lib/errors';
import { formatTzs } from '../../../src/lib/money';
import { appointmentApi, doctorApi, patientApi } from '../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

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

  if (doctor.isPending) return <LoadingState />;
  if (doctor.isError) {
    return (
      <ErrorState
        message={errorMessage(doctor.error, t('common.error.generic'))}
        onRetry={() => void doctor.refetch()}
      />
    );
  }

  const verifiedNhif = profile.data?.insurance?.verifiedNhif === true;
  const types = availableTypes(doctor.data);
  const intents = availableIntents({ type, verifiedNhif });
  if (!types.includes(type)) setType('VIDEO');
  if (!intents.includes(intent)) setIntent('MOBILE_MONEY');

  return (
    <Screen>
      <Title>{doctor.data.fullName}</Title>
      <Body muted>
        {doctor.data.specialty.replace(/_/g, ' ')} · {formatTzs(doctor.data.consultationFeeTzs)} ·{' '}
        {`★ ${doctor.data.averageRating.toFixed(1)}`}
      </Body>
      {doctor.data.bio !== null ? <Body>{doctor.data.bio}</Body> : null}

      {/* Date strip: next 7 EAT days */}
      <Body muted>{t('doctors.detail.availability')}</Body>
      <ChipRow
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
        <LoadingState />
      ) : availability.isError ? (
        <ErrorState
          message={errorMessage(availability.error, t('common.error.generic'))}
          onRetry={() => void availability.refetch()}
        />
      ) : availability.data.slots.length === 0 ? (
        <EmptyState message={t('doctors.detail.noSlots')} />
      ) : (
        <View style={styles.slotGrid}>
          {availability.data.slots.map((entry) => (
            <View key={entry.startUtc} style={styles.slotCell}>
              <Button
                label={entry.startEat}
                onPress={() => {
                  setSlot(entry.startUtc);
                  setSlotTaken(false);
                }}
                disabled={slot === entry.startUtc}
              />
            </View>
          ))}
        </View>
      )}
      {slotTaken ? <Text style={styles.slotTaken}>{t('booking.slotTaken')}</Text> : null}

      {slot !== null ? (
        <View style={styles.bookingBox}>
          <Text style={styles.sectionTitle}>{t('booking.title')}</Text>
          <Body muted>
            {t('booking.slot', {
              time: `${date} ${availability.data?.slots.find((s) => s.startUtc === slot)?.startEat ?? ''}`,
            })}
          </Body>

          <Body muted>{t('booking.type')}</Body>
          <ChipRow
            options={types.map((value) => ({ value, label: t(`booking.type.${value}` as never) }))}
            value={type}
            onChange={setType}
          />

          <TextField
            label={t('booking.reason')}
            value={reason}
            onChangeText={setReason}
            multiline
            error={reason.length > 0 && !reasonValid ? t('booking.reason.error') : undefined}
          />

          <Body muted>{t('booking.intent.title')}</Body>
          <ChipRow
            options={intents.map((value) => ({ value, label: t(`booking.intent.${value}` as never) }))}
            value={intent}
            onChange={setIntent}
          />

          {book.isError && !(isApiError(book.error) && book.error.code === 'SLOT_TAKEN') ? (
            <Text style={styles.slotTaken}>{errorMessage(book.error, t('common.error.generic'))}</Text>
          ) : null}

          <Button
            label={t('booking.confirm')}
            onPress={() => book.mutate()}
            disabled={!reasonValid || book.isPending}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slotCell: { minWidth: 90 },
  slotTaken: { ...typography.body, color: colors.danger },
  bookingBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { ...typography.subtitle, color: colors.text },
});
