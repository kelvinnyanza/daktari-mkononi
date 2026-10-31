/**
 * Consultation rating: overall stars (required) + optional sub-ratings and
 * comment. Used on Appointment details and right after the call ends.
 * One rating per consultation — the server is the arbiter (409
 * ALREADY_RATED is treated as "done", never as a failure).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Body, Button, TextField } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { ratingApi } from '../../services/endpoints';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { isAlreadyRated } from './post-call';

export function RatingSection({
  appointmentId,
  onDone,
}: {
  appointmentId: string;
  /** Rated (or already rated elsewhere) — the post-call flow moves on. */
  onDone?: () => void;
}): React.JSX.Element | null {
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
      onDone?.();
    },
    onError: async (error) => {
      if (isAlreadyRated(error)) {
        await queryClient.invalidateQueries({ queryKey: ['rating', appointmentId] });
        onDone?.();
      }
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
      {submit.isError && !isAlreadyRated(submit.error) ? <Body>{errorMessage(submit.error)}</Body> : null}
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

export function Stars({
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
          accessibilityLabel={`${String(star)} ★`}
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
  stars: { flexDirection: 'row', gap: spacing.sm },
  star: { fontSize: 32, color: colors.border },
  starActive: { color: '#E8A13A' },
});
