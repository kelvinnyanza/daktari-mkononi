/**
 * The app's tiny component kit — RN primitives + tokens only (no UI library:
 * every kilobyte matters on low-RAM devices). All copy arrives via t().
 */
import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useT } from '../i18n';
import { colors, radius, spacing, typography } from '../theme/tokens';

export function Screen({ children }: PropsWithChildren): React.JSX.Element {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function Title({ children }: PropsWithChildren): React.JSX.Element {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: PropsWithChildren<{ muted?: boolean }>): React.JSX.Element {
  return <Text style={[styles.body, muted === true && styles.bodyMuted]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled === true}
      style={({ pressed }) => [
        styles.button,
        destructive === true && styles.buttonDestructive,
        (disabled === true || pressed) && styles.buttonDim,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

export function LinkButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.linkButton}>
      <Text style={styles.linkLabel}>{label}</Text>
    </Pressable>
  );
}

export function TextField({
  label,
  error,
  ...inputProps
}: TextInputProps & { label: string; error?: string | undefined }): React.JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, error !== undefined && styles.inputError]}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        {...inputProps}
      />
      {error !== undefined ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

/** Selectable chip row (gender, region pickers, tabs). */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="button"
          accessibilityState={{ selected: option.value === value }}
          onPress={() => onChange(option.value)}
          style={[styles.chip, option.value === value && styles.chipSelected]}
        >
          <Text style={[styles.chipLabel, option.value === value && styles.chipLabelSelected]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function LoadingState(): React.JSX.Element {
  const t = useT();
  return (
    <View style={styles.stateBox}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Body muted>{t('common.loading')}</Body>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <View style={styles.stateBox}>
      <Body>{message}</Body>
      <Button label={t('common.retry')} onPress={onRetry} />
    </View>
  );
}

export function EmptyState({ message }: { message: string }): React.JSX.Element {
  return (
    <View style={styles.stateBox}>
      <Body muted>{message}</Body>
    </View>
  );
}

/** Always-visible 112/115 strip. */
export function EmergencyBanner(): React.JSX.Element {
  const t = useT();
  return (
    <View style={styles.emergency} accessibilityRole="alert">
      <Text style={styles.emergencyText}>{t('emergency.banner')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.md, gap: spacing.md },
  title: { ...typography.title, color: colors.text },
  body: { ...typography.body, color: colors.text },
  bodyMuted: { color: colors.textMuted },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  buttonDestructive: { backgroundColor: colors.danger },
  buttonDim: { opacity: 0.6 },
  buttonLabel: { ...typography.button, color: colors.onPrimary },
  linkButton: { paddingVertical: spacing.sm, alignItems: 'center' },
  linkLabel: { ...typography.body, color: colors.primaryDark },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.caption, color: colors.textMuted },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.background,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { ...typography.caption, color: colors.danger },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipLabel: { ...typography.caption, color: colors.text },
  chipLabelSelected: { color: colors.onPrimary },
  stateBox: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emergency: {
    backgroundColor: colors.emergencySurface,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  emergencyText: { ...typography.caption, color: colors.onEmergency, fontWeight: '700' },
});
