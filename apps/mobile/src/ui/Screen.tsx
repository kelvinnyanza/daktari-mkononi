import type { PropsWithChildren, ReactElement, ReactNode } from 'react';
import { ScrollView, View, useWindowDimensions, type RefreshControlProps } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { createStyles, layout, space } from '../theme/theme';

/** Phone vs tablet: wider gutters and a centred, capped content column on tablets. */
export function useResponsive(): { isTablet: boolean; gutter: number } {
  const { width } = useWindowDimensions();
  const isTablet = width >= layout.tabletBreakpoint;
  return { isTablet, gutter: isTablet ? layout.gutterTablet : layout.gutterPhone };
}

/**
 * Every screen's frame: safe area, background, optional header, a scrolling
 * column capped at maxContentWidth (centred on tablets), and an optional
 * sticky footer for the primary action (thumb reach).
 */
export function Screen({
  children,
  header,
  footer,
  scroll = true,
  refreshControl,
  edges = ['top', 'left', 'right'],
}: PropsWithChildren<{
  header?: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
  refreshControl?: ReactElement<RefreshControlProps>;
  edges?: Edge[];
}>): React.JSX.Element {
  const styles = useStyles();
  const { gutter } = useResponsive();
  const column = [styles.column, { paddingHorizontal: gutter }];

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {header !== undefined ? <View style={styles.headerWrap}><View style={styles.headerInner}>{header}</View></View> : null}
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          {...(refreshControl !== undefined ? { refreshControl } : {})}
        >
          <View style={column}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.root, column]}>{children}</View>
      )}
      {footer !== undefined ? (
        <View style={styles.footer}>
          <View style={[styles.footerInner, { paddingHorizontal: gutter }]}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** Vertical group with consistent spacing (sections inside a screen). */
export function Stack({ children, gap = 3 }: PropsWithChildren<{ gap?: keyof typeof space }>): React.JSX.Element {
  return <View style={{ gap: space[gap] }}>{children}</View>;
}

/** Section title + content. */
export function Section({ children, title, action }: PropsWithChildren<{ title?: ReactNode; action?: ReactNode }>): React.JSX.Element {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      {title !== undefined || action !== undefined ? (
        <View style={styles.sectionHead}>
          <View style={styles.sectionTitle}>{title}</View>
          {action}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const useStyles = createStyles((c) => ({
  root: { flex: 1, backgroundColor: c.background },
  headerWrap: { backgroundColor: c.background, alignItems: 'center' },
  headerInner: { width: '100%', maxWidth: layout.maxContentWidth + 2 * layout.gutterTablet },
  scrollContent: { flexGrow: 1, alignItems: 'center', paddingTop: space[2], paddingBottom: space[8] },
  column: { width: '100%', maxWidth: layout.maxContentWidth + 2 * layout.gutterTablet, gap: space[6] },
  footer: {
    alignItems: 'center',
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingVertical: space[3],
  },
  footerInner: { width: '100%', maxWidth: layout.maxContentWidth + 2 * layout.gutterTablet, gap: space[2] },
  section: { gap: space[3] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  sectionTitle: { flex: 1 },
}));
