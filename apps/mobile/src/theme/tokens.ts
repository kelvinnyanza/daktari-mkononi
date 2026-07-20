/**
 * Design tokens — the single source of visual truth. Light theme first;
 * system font only (no downloads on 2G). All text/background pairs used in
 * the app meet WCAG AA (≥ 4.5:1) — verified by src/theme/tokens.test.ts.
 */

export const colors = {
  // Brand
  primary: '#0B6E4F', // deep green — text-safe on white
  primaryDark: '#08573E',
  onPrimary: '#FFFFFF',
  // Surfaces
  background: '#FFFFFF',
  surface: '#F4F6F5',
  border: '#D5DBD8',
  // Text
  text: '#17211C',
  textMuted: '#4A5A52',
  onSurface: '#17211C',
  // Feedback
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  success: '#0B6E4F',
  warningSurface: '#FFF3E0',
  onWarningSurface: '#5C3B00',
  // Emergency strip
  emergencySurface: '#B3261E',
  onEmergency: '#FFFFFF',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** Type scale — system font, sizes tuned for small, low-density screens. */
export const typography = {
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
  button: { fontSize: 16, fontWeight: '600' },
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

/** Relative luminance per WCAG. */
function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

/** Contrast ratio between two hex colors — used by the token tests. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}
