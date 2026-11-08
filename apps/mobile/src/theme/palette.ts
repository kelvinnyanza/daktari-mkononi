/**
 * Raw brand palette — "calm clinic". NEVER import these in a component: use
 * the semantic roles in theme.ts (`useTheme().colors`), so a dark theme is a
 * second role table, not a hunt through screens. Every role pairing is
 * contrast-tested in theme.test.ts.
 */
export const palette = {
  // Primary — teal. 600 is the text-safe brand teal (5.7:1 on white).
  teal50: '#EEF8F6',
  teal100: '#E3F3F0',
  teal200: '#A9DED4',
  teal300: '#8FD9C6', // mint — logo hand, decorative accents only (not text)
  teal400: '#3FAA98', // decorative only (2.8:1 on white)
  teal600: '#0F7366',
  teal700: '#0B5E54',
  teal800: '#0A4A43',

  // Secondary — leaf green, for health/success moments and illustrations.
  leaf50: '#E7F5EC',
  leaf200: '#B6DEC3',
  leaf700: '#1C6B3A',

  // Neutrals — slightly green-tinted greys so white space feels warm, not grey.
  white: '#FFFFFF',
  neutral25: '#F6F9F8', // app background
  neutral50: '#EEF3F2', // muted surface
  neutral100: '#E9EEED', // disabled fill
  neutral200: '#D9E1DF', // hairline borders (decorative)
  neutral400: '#84928F', // input borders — 3.2:1 (WCAG 1.4.11 non-text ≥ 3:1)
  neutral500: '#66736F', // disabled text
  neutral600: '#4E5B58', // secondary text (7.1:1)
  neutral900: '#17201E', // primary text (16.6:1)

  // Status
  amber50: '#FFF5E0',
  amber200: '#F2D39A',
  amber800: '#7A4A00',
  red50: '#FEEDEB',
  red200: '#F5C2BC',
  red700: '#B42318',
  blue50: '#EAF2FB',
  blue200: '#BCD5EE',
  blue700: '#1D5A96',

  // Emergency (112/115) — its own hue family, never softened or tinted.
  emergency: '#B91C1C',
  emergencyPressed: '#991B1B',

  // Avatar tints (fg on bg ≥ 4.5:1, tested).
  sand50: '#FDF1DF',
  sky50: '#EAF2FB',
} as const;
