import { View } from 'react-native';
import { palette } from '../theme/palette';
import { createStyles, radius } from '../theme/theme';
import { Text } from './Text';

/** Honorifics dropped before taking initials ("Dkt. Amina Mushi" → "AM"). */
const TITLES = new Set(['dkt', 'dkt.', 'dr', 'dr.', 'daktari', 'prof', 'prof.']);

/** "Dkt. Amina Mushi" → "Amina" (for greetings); '' when there is no name. */
export function firstName(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .find((word) => word !== '' && !TITLES.has(word.toLowerCase())) ?? ''
  );
}

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '' && !TITLES.has(word.toLowerCase()));
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** Calm tint pairs (fg on bg ≥ 4.5:1, tested). Chosen by name so a person keeps their colour. */
export const AVATAR_TINTS = [
  { bg: palette.teal100, fg: palette.teal700 },
  { bg: palette.leaf50, fg: palette.leaf700 },
  { bg: palette.sky50, fg: palette.blue700 },
  { bg: palette.sand50, fg: palette.amber800 },
] as const;

function tintFor(name: string): (typeof AVATAR_TINTS)[number] {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]!;
}

const SIZE = { sm: 40, md: 48, lg: 72 } as const;

/** Initials avatar — no photos (bandwidth, privacy). Decorative: the name is always shown beside it. */
export function Avatar({ name, size = 'md' }: { name: string; size?: keyof typeof SIZE }): React.JSX.Element {
  const styles = useStyles();
  const tint = tintFor(name);
  const px = SIZE[size];
  return (
    <View
      style={[styles.circle, { width: px, height: px, backgroundColor: tint.bg }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        variant={size === 'lg' ? 'title' : 'bodyStrong'}
        style={{ color: tint.fg }}
        allowFontScaling={false /* fixed circle; the name next to it scales */}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

const useStyles = createStyles(() => ({
  circle: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
}));
