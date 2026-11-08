/**
 * Nunito Sans (SIL OFL) — open, friendly humanist sans with a generous
 * x-height; reads well at small sizes on low-DPI panels, and its moderate
 * width keeps long Swahili words ("Mashauriano", "Imethibitishwa") on one
 * line more often than wider geometric faces.
 *
 * Only three weights ship (~113 KB each). Import per-weight subpaths — the
 * package root re-exports all 16 files and would bundle every one of them.
 * Loaded at runtime by expo-font (already in the native build): no new EAS
 * build is needed for the font.
 */
import Feather from '@expo/vector-icons/Feather';
import { NunitoSans_400Regular } from '@expo-google-fonts/nunito-sans/400Regular';
import { NunitoSans_600SemiBold } from '@expo-google-fonts/nunito-sans/600SemiBold';
import { NunitoSans_700Bold } from '@expo-google-fonts/nunito-sans/700Bold';

export const fontFamily = {
  regular: 'NunitoSans_400Regular',
  semibold: 'NunitoSans_600SemiBold',
  bold: 'NunitoSans_700Bold',
} as const;

/**
 * The map handed to useFonts() in the root layout. Includes the Feather icon
 * font (56 KB) so icons never render blank on their first frame.
 */
export const fontAssets = {
  ...Feather.font,
  [fontFamily.regular]: NunitoSans_400Regular,
  [fontFamily.semibold]: NunitoSans_600SemiBold,
  [fontFamily.bold]: NunitoSans_700Bold,
};
