import { parseTipBody } from '@daktari/schemas';
import { View } from 'react-native';
import { createStyles, space, useTheme } from '../../theme/theme';
import { Text } from '../../ui';

/**
 * Renders the tip article (headings, paragraphs, bullet lists) — the same
 * parser the admin preview uses. Plain Text only: scales with the system font
 * size, no clipping, no links/HTML.
 */
export function TipBody({ text }: { text: string }): React.JSX.Element {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      {parseTipBody(text).map((block, index) => {
        if (block.type === 'heading') {
          return (
            <Text key={index} variant="heading" accessibilityRole="header" style={styles.heading}>
              {block.text}
            </Text>
          );
        }
        if (block.type === 'paragraph') {
          return (
            <Text key={index} style={styles.paragraph}>
              {block.text}
            </Text>
          );
        }
        return (
          <View key={index} style={styles.list}>
            {block.items.map((item, i) => (
              <View key={i} style={styles.bulletRow}>
                <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                <Text style={styles.bulletText}>{item}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = createStyles(() => ({
  wrap: { gap: space[3] },
  heading: { marginTop: space[2] },
  paragraph: { lineHeight: 26 },
  list: { gap: space[2] },
  bulletRow: { flexDirection: 'row', gap: space[3], alignItems: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4, marginTop: 9 },
  bulletText: { flex: 1, lineHeight: 26 },
}));
