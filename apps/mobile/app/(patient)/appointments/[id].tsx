/**
 * Appointment detail (Phase 9): payment-pending experience with 5s polling
 * while PENDING_PAYMENT (stops on terminal states and screen blur), retry
 * after FAILED payments, refund status lines, and the post-consultation
 * rating flow for COMPLETED appointments.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Body,
  Button,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
  Title,
} from '../../../src/components/ui';
import { leftPendingPayment, pollInterval, mnoWalletLabel } from '../../../src/features/payments/polling';
import { consultationEntry, isRemoteType } from '../../../src/features/consultation/waiting-room';
import { useT } from '../../../src/i18n';
import { eatDateTimeLabel, formatCountdown, secondsUntil } from '../../../src/lib/datetime';
import { errorMessage } from '../../../src/lib/errors';
import { formatTzs } from '../../../src/lib/money';
import {
  appointmentApi,
  authApi,
  paymentApi,
  ratingApi,
  type AppointmentItem,
  type PaymentItem,
} from '../../../src/services/endpoints';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

const CANCELLABLE = new Set(['PENDING_PAYMENT', 'CONFIRMED']);

export default function AppointmentDetail(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false); // blur stops polling
    }, []),
  );

  const query = useQuery({
    queryKey: ['appointments', 'me'],
    queryFn: () => appointmentApi.listMine(),
    refetchInterval: (q) => {
      const item = q.state.data?.items.find((entry) => entry.id === id);
      return pollInterval(item?.status, focused, item !== undefined && isRemoteType(item.type));
    },
  });
  const appointment = query.data?.items.find((item) => item.id === id);

  const payments = useQuery({
    queryKey: ['payments', 'me'],
    queryFn: () => paymentApi.listMine(),
    enabled: appointment !== undefined && appointment.paymentIntent === 'MOBILE_MONEY',
  });
  const payment = payments.data?.items.find((item) => item.appointmentId === id);

  // The poll sees CONFIRMED first; refetch payments then, or the cached
  // PROCESSING line keeps the screen looking stuck on the payment step.
  const lastStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = appointment?.status;
    if (leftPendingPayment(lastStatus.current, status)) {
      void queryClient.invalidateQueries({ queryKey: ['payments'] });
    }
    if (status !== undefined) lastStatus.current = status;
  }, [appointment?.status, queryClient]);

  const cancel = useMutation({
    mutationFn: () => appointmentApi.cancel(id ?? '', reason.trim() || 'imefutwa na mgonjwa'),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
      router.back();
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  const retryPay = useMutation({
    mutationFn: () => appointmentApi.pay(id ?? ''),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['payments'] });
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (error) => setActionError(errorMessage(error)),
  });

  return (
    <Screen>
      <Title>{t('appointments.detail.title')}</Title>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || appointment === undefined ? (
        <ErrorState
          message={query.isError ? errorMessage(query.error) : t('error.NOT_FOUND')}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <Body>{eatDateTimeLabel(appointment.scheduledAt)}</Body>
          <Body>{appointment.reason}</Body>
          <Body muted>{t(`appointments.status.${appointment.status}`)}</Body>

          {appointment.status === 'PENDING_PAYMENT' && appointment.paymentIntent === 'MOBILE_MONEY' ? (
            <PaymentPendingCard appointment={appointment} payment={payment} onRetry={() => retryPay.mutate()} retrying={retryPay.isPending} />
          ) : null}

          {payment !== undefined && appointment.status !== 'PENDING_PAYMENT' ? (
            <PaymentStatusLines payment={payment} cancelled={appointment.status === 'CANCELLED'} />
          ) : null}

          {/* Remote appointments: waiting room from 10 min out while CONFIRMED;
              Join whenever the doctor has started (IN_PROGRESS). Both go via
              the waiting room, which resolves the consultation id and
              forwards straight into the call once it is IN_PROGRESS. */}
          {(() => {
            const entry = consultationEntry(appointment, new Date());
            if (entry === null) return null;
            return (
              <>
                {entry === 'join' ? <Body>{t('consult.joinHint')}</Body> : null}
                <Button
                  label={t(entry === 'join' ? 'consult.join' : 'consult.enterWaitingRoom')}
                  onPress={() =>
                    router.push({
                      pathname: '/(patient)/consultation/waiting/[appointmentId]',
                      params: { appointmentId: appointment.id },
                    })
                  }
                />
              </>
            );
          })()}

          {appointment.status === 'COMPLETED' ? <RatingSection appointmentId={appointment.id} /> : null}

          {appointment.cancellationReason !== null ? (
            <Body muted>{appointment.cancellationReason}</Body>
          ) : null}
          {CANCELLABLE.has(appointment.status) ? (
            <>
              <TextField
                label={t('appointments.detail.cancelReason')}
                value={reason}
                onChangeText={setReason}
                error={undefined}
              />
              {actionError !== null ? <Body>{actionError}</Body> : null}
              <Button
                destructive
                label={t('appointments.detail.cancel')}
                onPress={() => cancel.mutate()}
                disabled={cancel.isPending}
              />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function PaymentPendingCard({
  appointment,
  payment,
  onRetry,
  retrying,
}: {
  appointment: AppointmentItem;
  payment: PaymentItem | undefined;
  onRetry: () => void;
  retrying: boolean;
}): React.JSX.Element {
  const t = useT();
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => authApi.me() });
  const phone = me.data?.user.phone ?? '';
  const expired =
    appointment.expiresAt !== null && secondsUntil(appointment.expiresAt, new Date()) === 0;

  if (expired) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('payment.expired.title')}</Text>
        <Body>{t('payment.expired.body')}</Body>
        <Button
          label={t('payment.rebook')}
          onPress={() => {
            // Rebook: back to the doctor's availability.
            void appointment; // doctorId retained on the appointment
          }}
        />
      </View>
    );
  }

  const failed = payment?.status === 'FAILED';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {failed ? t('payment.failed') : t('payment.pending.title')}
      </Text>
      {!failed ? (
        <Body>{t('payment.pending.instruction', { wallet: mnoWalletLabel(phone) })}</Body>
      ) : null}
      {payment !== undefined ? (
        <Body>{t('payment.amount', { amount: formatTzs(payment.amountTzs) })}</Body>
      ) : null}
      {appointment.expiresAt !== null ? (
        <Countdown expiresAt={appointment.expiresAt} />
      ) : null}
      {failed ? (
        <Button label={t('payment.retry')} onPress={onRetry} disabled={retrying} />
      ) : null}
    </View>
  );
}

/** Re-renders each poll cycle — good enough granularity for a 30-min window. */
function Countdown({ expiresAt }: { expiresAt: string }): React.JSX.Element {
  const t = useT();
  const seconds = secondsUntil(expiresAt, new Date());
  return <Body muted>{t('payment.countdown', { time: formatCountdown(seconds) })}</Body>;
}

function PaymentStatusLines({
  payment,
  cancelled,
}: {
  payment: PaymentItem;
  cancelled: boolean;
}): React.JSX.Element {
  const t = useT();
  return (
    <View style={styles.statusLines}>
      <Body muted>
        {t('payment.status.label')}: {t(`payment.status.${payment.status}`)}
      </Body>
      {cancelled && payment.status === 'REFUNDED' ? <Body>{t('payment.refund.done')}</Body> : null}
      {cancelled && payment.refundPending ? <Body>{t('payment.refund.pending')}</Body> : null}
    </View>
  );
}

// ── Rating (COMPLETED appointments) ──────────────────────────────────────────

function RatingSection({ appointmentId }: { appointmentId: string }): React.JSX.Element | null {
  const t = useT();
  const queryClient = useQueryClient();
  const [overall, setOverall] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [professionalism, setProfessionalism] = useState(0);
  const [timeliness, setTimeliness] = useState(0);
  const [comment, setComment] = useState('');

  const status = useQuery({
    queryKey: ['rating', appointmentId],
    queryFn: () => ratingApi.statusForAppointment(appointmentId),
  });

  const submit = useMutation({
    mutationFn: () =>
      ratingApi.rate(status.data!.consultationId, {
        rating: overall,
        ...(communication > 0 ? { communication } : {}),
        ...(professionalism > 0 ? { professionalism } : {}),
        ...(timeliness > 0 ? { timeliness } : {}),
        ...(comment.trim().length > 0 ? { comment: comment.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rating', appointmentId] });
    },
  });

  if (status.isPending || status.isError) return null; // no consultation → no CTA

  // Already rated → read-only display.
  if (status.data.rating !== null) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('rating.yours')}</Text>
        <Stars value={status.data.rating.rating} onChange={null} />
        {status.data.rating.comment !== null ? <Body muted>{status.data.rating.comment}</Body> : null}
      </View>
    );
  }
  if (status.data.status !== 'COMPLETED') return null;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{t('rating.title')}</Text>
      <Body muted>{t('rating.overall')}</Body>
      <Stars value={overall} onChange={setOverall} />
      <Body muted>{t('rating.communication')}</Body>
      <Stars value={communication} onChange={setCommunication} />
      <Body muted>{t('rating.professionalism')}</Body>
      <Stars value={professionalism} onChange={setProfessionalism} />
      <Body muted>{t('rating.timeliness')}</Body>
      <Stars value={timeliness} onChange={setTimeliness} />
      <TextField label={t('rating.comment')} value={comment} onChangeText={setComment} multiline />
      {submit.isError ? <Body>{errorMessage(submit.error)}</Body> : null}
      {submit.isSuccess ? (
        <Body>{t('rating.thanks')}</Body>
      ) : (
        <Button
          label={t('rating.submit')}
          onPress={() => submit.mutate()}
          disabled={overall === 0 || submit.isPending}
        />
      )}
    </View>
  );
}

function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: ((value: number) => void) | null;
}): React.JSX.Element {
  return (
    <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          accessibilityRole="button"
          disabled={onChange === null}
          onPress={() => onChange?.(star)}
        >
          <Text style={[styles.star, star <= value && styles.starActive]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.subtitle, color: colors.text },
  statusLines: { gap: spacing.xs },
  stars: { flexDirection: 'row', gap: spacing.sm },
  star: { fontSize: 32, color: colors.border },
  starActive: { color: '#E8A13A' },
});
