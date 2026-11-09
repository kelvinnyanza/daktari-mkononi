/**
 * Consultation rating: overall stars (required) + optional sub-ratings and
 * comment. Used on Appointment details and right after the call ends.
 * One rating per consultation — the server is the arbiter (409
 * ALREADY_RATED is treated as "done", never as a failure).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/errors';
import { ratingApi } from '../../services/endpoints';
import { createStyles, layout, radius, space, useTheme } from '../../theme/theme';
import { Banner, Button, Card, Icon, Input, Text } from '../../ui';
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
      <Card>
        <Text variant="heading" accessibilityRole="header">
          {t('rating.yours')}
        </Text>
        <Stars value={status.data.rating.rating} onChange={null} />
        {status.data.rating.comment !== null ? <Text tone="secondary">{status.data.rating.comment}</Text> : null}
      </Card>
    );
  }
  if (status.data.status !== 'COMPLETED') return null;

  return (
    <Card>
      <Text variant="heading" accessibilityRole="header">
        {t('rating.title')}
      </Text>
      <Text variant="label">{t('rating.overall')}</Text>
      <Stars value={overall} onChange={setOverall} />
      <Text variant="label" tone="secondary">
        {t('rating.communication')}
      </Text>
      <Stars value={communication} onChange={setCommunication} />
      <Text variant="label" tone="secondary">
        {t('rating.professionalism')}
      </Text>
      <Stars value={professionalism} onChange={setProfessionalism} />
      <Text variant="label" tone="secondary">
        {t('rating.timeliness')}
      </Text>
      <Stars value={timeliness} onChange={setTimeliness} />
      <Input label={t('rating.comment')} value={comment} onChangeText={setComment} multiline />
      {submit.isError && !isAlreadyRated(submit.error) ? <Banner tone="danger" message={errorMessage(submit.error)} /> : null}
      {submit.isSuccess ? (
        <Banner tone="success" message={t('rating.thanks')} />
      ) : (
        <Button
          icon="send"
          label={t('rating.submit')}
          onPress={() => submit.mutate()}
          loading={submit.isPending}
          disabled={overall === 0}
        />
      )}
    </Card>
  );
}

/**
 * 1–5 stars, 48dp each. Filled = teal (non-text contrast ≥ 3:1 — the old
 * amber failed it), empty = outline. Read-only when onChange is null.
 */
export function Stars({
  value,
  onChange,
}: {
  value: number;
  onChange: ((value: number) => void) | null;
}): React.JSX.Element {
  const t = useT();
  const styles = useStyles();
  const { colors } = useTheme();
  if (onChange === null) {
    return (
      <View style={styles.stars} accessible accessibilityLabel={t('rating.starLabel', { n: value })}>
        {[1, 2, 3, 4, 5].map((star) => (
          <StarGlyph key={star} filled={star <= value} color={star <= value ? colors.primary : colors.borderStrong} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.stars} accessibilityRole="radiogroup">
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable
          key={star}
          accessibilityRole="radio"
          accessibilityLabel={t('rating.starLabel', { n: star })}
          accessibilityState={{ checked: star === value }}
          onPress={() => onChange(star)}
          style={({ pressed }) => [styles.starButton, pressed && styles.starPressed]}
        >
          <StarGlyph filled={star <= value} color={star <= value ? colors.primary : colors.borderStrong} />
        </Pressable>
      ))}
    </View>
  );
}

/** Feather's star is outline-only; filled = a solid ★ in the same footprint. */
function StarGlyph({ filled, color }: { filled: boolean; color: string }): React.JSX.Element {
  const styles = useStyles();
  return filled ? (
    <Text allowFontScaling={false} style={[styles.solidStar, { color }]}>
      ★
    </Text>
  ) : (
    <Icon name="star" size={30} color={color} />
  );
}

const useStyles = createStyles((c) => ({
  stars: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  starButton: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starPressed: { backgroundColor: c.primarySoft },
  solidStar: { fontSize: 34, lineHeight: 38 },
}));
