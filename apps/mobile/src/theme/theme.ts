/**
 * Design system tokens — the single source of truth for the patient app.
 *
 * Layers:
 *  - palette.ts  raw hex (never used directly by components)
 *  - ThemeColors semantic roles (this file) — a dark theme is a second
 *    ThemeColors object handed to <ThemeProvider>; no component changes.
 *  - space / radius / type / elevation / layout — theme-independent scales.
 *
 * Accessibility contract (tested in theme.test.ts): every text role meets
 * WCAG AA (≥ 4.5:1) on the surfaces it is used on; input borders and focus
 * rings meet 3:1. Touch targets are ≥ 48dp (layout.touchTarget).
 */
import { createContext, useContext } from 'react';
import { StyleSheet } from 'react-native';
import { palette } from './palette';
import { fontFamily } from './fonts';

export interface ThemeColors {
  // Surfaces
  background: string; // screen background
  surface: string; // cards, sheets, inputs
  surfaceMuted: string; // grouped rows, skeleton base
  border: string; // decorative hairlines (cards, dividers)
  borderStrong: string; // interactive outlines (inputs) — ≥ 3:1
  overlay: string; // modal backdrop
  // Text
  text: string;
  textSecondary: string;
  textDisabled: string;
  textOnPrimary: string;
  // Brand
  primary: string;
  primaryPressed: string;
  primarySoft: string; // tonal fills (secondary button, selected chip)
  primarySoftPressed: string;
  onPrimarySoft: string;
  accent: string; // decorative mint (logo hand, illustrations) — never text
  focus: string; // focus ring — dark ink, visible on teal, red and white alike
  // Disabled controls
  disabledFill: string;
  // Status (fg is text-safe on its own bg)
  successBg: string;
  successBorder: string;
  successFg: string;
  warningBg: string;
  warningBorder: string;
  warningFg: string;
  dangerBg: string;
  dangerBorder: string;
  dangerFg: string; // also the danger button fill
  dangerPressed: string;
  infoBg: string;
  infoBorder: string;
  infoFg: string;
  neutralBg: string;
  neutralBorder: string;
  neutralFg: string;
  // Emergency — always solid high-contrast red; no theme may soften it.
  emergencyBg: string;
  emergencyPressed: string;
  onEmergency: string;
}

export const lightColors: ThemeColors = {
  background: palette.neutral25,
  surface: palette.white,
  surfaceMuted: palette.neutral50,
  border: palette.neutral200,
  borderStrong: palette.neutral400,
  overlay: 'rgba(23, 32, 30, 0.45)',
  text: palette.neutral900,
  textSecondary: palette.neutral600,
  textDisabled: palette.neutral500,
  textOnPrimary: palette.white,
  primary: palette.teal600,
  primaryPressed: palette.teal700,
  primarySoft: palette.teal100,
  primarySoftPressed: palette.teal200,
  onPrimarySoft: palette.teal700,
  accent: palette.teal300,
  focus: palette.neutral900,
  disabledFill: palette.neutral100,
  successBg: palette.leaf50,
  successBorder: palette.leaf200,
  successFg: palette.leaf700,
  warningBg: palette.amber50,
  warningBorder: palette.amber200,
  warningFg: palette.amber800,
  dangerBg: palette.red50,
  dangerBorder: palette.red200,
  dangerFg: palette.red700,
  dangerPressed: palette.emergencyPressed,
  infoBg: palette.blue50,
  infoBorder: palette.blue200,
  infoFg: palette.blue700,
  neutralBg: palette.neutral50,
  neutralBorder: palette.neutral200,
  neutralFg: palette.neutral600,
  emergencyBg: palette.emergency,
  emergencyPressed: palette.emergencyPressed,
  onEmergency: palette.white,
};

/** 4dp grid. Use the numeric step (space[4] = 16), never raw numbers. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = {
  sm: 8, // chips' inner elements, skeleton lines
  md: 12, // buttons, inputs, list rows
  lg: 16, // cards, banners
  xl: 24, // bottom sheet top corners
  pill: 999, // pills, avatars, icon buttons
} as const;

/**
 * Type scale — Nunito Sans. Each step sets the family for its weight (custom
 * fonts on Android ignore fontWeight). lineHeight scales with the system font
 * size, so never pin a container's height around text.
 */
export const type = {
  display: { fontFamily: fontFamily.bold, fontSize: 28, lineHeight: 36 },
  title: { fontFamily: fontFamily.bold, fontSize: 22, lineHeight: 30 },
  heading: { fontFamily: fontFamily.semibold, fontSize: 18, lineHeight: 26 },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18 },
  button: { fontFamily: fontFamily.bold, fontSize: 16, lineHeight: 22 },
} as const;

export type TypeVariant = keyof typeof type;

/** Soft, low elevation only — heavy shadows read as "busy" on cheap panels. */
export const elevation = {
  none: {},
  sm: {
    shadowColor: '#0B2E29',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  md: {
    shadowColor: '#0B2E29',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
} as const;

export const layout = {
  touchTarget: 48, // dp — minimum for anything tappable
  tabletBreakpoint: 600, // dp width (Lenovo Tab M9 portrait = 800dp)
  gutterPhone: space[4],
  gutterTablet: space[8],
  maxContentWidth: 640, // comfortable reading width on tablets
  hairline: StyleSheet.hairlineWidth,
  iconSize: 24,
} as const;

export interface Theme {
  name: 'light' | 'dark';
  colors: ThemeColors;
}

export const lightTheme: Theme = { name: 'light', colors: lightColors };

const ThemeContext = createContext<Theme>(lightTheme);

/** Provide a theme subtree (dark mode later). Light is the default without one. */
export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/**
 * Themed StyleSheet factory: `const useStyles = createStyles((c) => ({...}))`,
 * then `const styles = useStyles()` in the component. Styles are built once
 * per theme object and cached, so re-renders cost nothing.
 */
export function createStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
): () => T {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (styles === undefined) {
      styles = StyleSheet.create(factory(theme.colors));
      cache.set(theme, styles);
    }
    return styles;
  };
}
