/**
 * Appointment detail (Phase 9): payment-pending experience with 5s polling
 * while PENDING_PAYMENT (stops on terminal states and screen blur), retry
 * after FAILED payments, refund status lines, and the post-consultation
 * rating flow for COMPLETED appointments.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { RatingSection } from '../../../src/features/rating/RatingSection';
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
  type AppointmentItem,
  type PaymentItem,
} from '../../../src/services/endpoints';
import { space, useTheme } from '../../../src/theme/theme';
import {
  AppointmentStatusPill,
  Badge,
  Banner,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Header,
  Icon,
  Input,
  PaymentStatusPill,
  Screen,
  SkeletonCard,
  SkeletonGroup,
  Text,
  type IconName,
} from '../../../src/ui';

const CANCELLABLE = new Set(['PENDING_PAYMENT', 'CONFIRMED']);

export default function AppointmentDetail(): React.JSX.Element {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);

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
    onError: (error) => {
      setConfirmCancel(false); // close the dialog so the error banner is visible
      setActionError(errorMessage(error));
    },
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
    <Screen
      header={
        <Header
          title={t('appointments.detail.title')}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/(patient)/appointments'))}
        />
      }
    >
      {query.isPending ? (
        <SkeletonGroup>
          <SkeletonCard />
          <SkeletonCard />
        </SkeletonGroup>
      ) : query.isError || appointment === undefined ? (
        <ErrorState
          message={query.isError ? errorMessage(query.error) : t('error.NOT_FOUND')}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <Card>
            <AppointmentStatusPill status={appointment.status} />
            <DetailRow icon="calendar" label={t('appointments.detail.when')} value={eatDateTimeLabel(appointment.scheduledAt)} />
            <DetailRow
              icon={appointment.type === 'IN_PERSON' ? 'map-pin' : appointment.type === 'CHAT' ? 'message-square' : appointment.type === 'AUDIO' ? 'phone' : 'video'}
              label={t('booking.type')}
              value={t(`booking.type.${appointment.type}`)}
            />
            <DetailRow icon="edit-3" label={t('booking.reason')} value={appointment.reason} />
            {appointment.cancellationReason !== null ? (
              <DetailRow icon="x-circle" label={t('appointments.detail.cancelled')} value={appointment.cancellationReason} />
            ) : null}
          </Card>

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
              <View style={{ gap: space[3] }}>
                {entry === 'join' ? <Banner tone="success" icon="video" message={t('consult.joinHint')} /> : null}
                <Button
                  icon={entry === 'join' ? 'video' : 'log-in'}
                  label={t(entry === 'join' ? 'consult.join' : 'consult.enterWaitingRoom')}
                  onPress={() =>
                    router.push({
                      pathname: '/(patient)/consultation/waiting/[appointmentId]',
                      params: { appointmentId: appointment.id },
                    })
                  }
                />
              </View>
            );
          })()}

          {appointment.status === 'COMPLETED' ? <RatingSection appointmentId={appointment.id} /> : null}

          {actionError !== null ? <Banner tone="danger" message={actionError} /> : null}

          {CANCELLABLE.has(appointment.status) ? (
            <Card tone="muted">
              <Text variant="heading" accessibilityRole="header">
                {t('appointments.detail.cancel')}
              </Text>
              <Input label={t('appointments.detail.cancelReason')} value={reason} onChangeText={setReason} />
              <Button
                variant="danger"
                icon="x-circle"
                label={t('appointments.detail.cancel')}
                onPress={() => setConfirmCancel(true)}
                loading={cancel.isPending}
              />
              <ConfirmDialog
                visible={confirmCancel}
                title={t('appointments.detail.cancelConfirm.title')}
                message={t('appointments.detail.cancelConfirm.body')}
                confirmLabel={t('appointments.detail.cancelConfirm.yes')}
                cancelLabel={t('appointments.detail.cancelConfirm.no')}
                onConfirm={() => cancel.mutate()}
                onCancel={() => setConfirmCancel(false)}
                busy={cancel.isPending}
              />
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function DetailRow({ icon, label, value }: { icon: IconName; label: string; value: string }): React.JSX.Element {
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
  const router = useRouter();
  const me = useQuery({ queryKey: ['auth', 'me'], queryFn: () => authApi.me() });
  const phone = me.data?.user.phone ?? '';
  const expired =
    appointment.expiresAt !== null && secondsUntil(appointment.expiresAt, new Date()) === 0;

  if (expired) {
    return (
      <Card>
        <Banner tone="warning" title={t('payment.expired.title')} message={t('payment.expired.body')} />
        <Button
          icon="calendar"
          label={t('payment.rebook')}
          onPress={() =>
            // Rebook: the same doctor's availability + booking page.
            router.push({ pathname: '/(patient)/doctors/[id]', params: { id: appointment.doctorId } })
          }
        />
      </Card>
    );
  }

  const failed = payment?.status === 'FAILED';
  return (
    <Card>
      <Banner
        tone={failed ? 'danger' : 'warning'}
        icon={failed ? 'alert-circle' : 'smartphone'}
        title={failed ? t('payment.failed') : t('payment.pending.title')}
        message={
          failed
            ? t('payment.status.label') + ': ' + t('payment.status.FAILED')
            : t('payment.pending.instruction', { wallet: mnoWalletLabel(phone) })
        }
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
        {payment !== undefined ? <PaymentStatusPill status={payment.status} /> : null}
        {appointment.expiresAt !== null ? <Countdown expiresAt={appointment.expiresAt} /> : null}
      </View>
      {payment !== undefined ? (
        <Text variant="bodyStrong">{t('payment.amount', { amount: formatTzs(payment.amountTzs) })}</Text>
      ) : null}
      {failed ? <Button icon="refresh-cw" label={t('payment.retry')} onPress={onRetry} loading={retrying} /> : null}
    </Card>
  );
}

/** Re-renders each poll cycle — good enough granularity for a 30-min window. */
function Countdown({ expiresAt }: { expiresAt: string }): React.JSX.Element {
  const t = useT();
  const seconds = secondsUntil(expiresAt, new Date());
  return <Badge tone="warning" icon="clock" label={t('payment.countdown', { time: formatCountdown(seconds) })} />;
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
    <Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], alignItems: 'center' }}>
        <Text variant="label">{t('payment.status.label')}</Text>
        <PaymentStatusPill status={payment.status} />
      </View>
      {cancelled && payment.status === 'REFUNDED' ? <Banner tone="success" message={t('payment.refund.done')} /> : null}
      {cancelled && payment.refundPending ? <Banner tone="info" message={t('payment.refund.pending')} /> : null}
      {payment.status === 'COMPLETED' || payment.status === 'REFUNDED' ? (
        <View style={{ gap: space[2] }}>
          <Text variant="heading" accessibilityRole="header">
            {t('payment.receipt.title')}
          </Text>
          <ReceiptRow label={t('payment.receipt.fee')} value={formatTzs(payment.amountTzs)} strong />
          <ReceiptRow label={t('payment.receipt.commission')} value={formatTzs(payment.platformFeeTzs)} />
          <ReceiptRow label={t('payment.receipt.vat')} value={formatTzs(payment.vatTzs)} />
          <ReceiptRow label={t('payment.receipt.doctor')} value={formatTzs(payment.doctorAmountTzs)} />
          <Text variant="caption" tone="secondary">
            {t('payment.receipt.vatNote')}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** Label wraps on the left, amount stays whole on the right. */
function ReceiptRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
      <Text tone={strong ? 'default' : 'secondary'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'body'}>{value}</Text>
    </View>
  );
}
