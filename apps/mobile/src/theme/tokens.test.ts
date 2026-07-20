import { colors, contrastRatio } from './tokens';

/** WCAG AA for body text. */
const AA = 4.5;

describe('theme tokens', () => {
  it.each([
    ['text on background', colors.text, colors.background],
    ['muted text on background', colors.textMuted, colors.background],
    ['text on surface', colors.onSurface, colors.surface],
    ['button label on primary', colors.onPrimary, colors.primary],
    ['emergency text on emergency strip', colors.onEmergency, colors.emergencySurface],
    ['danger text on background', colors.danger, colors.background],
    ['warning text on warning surface', colors.onWarningSurface, colors.warningSurface],
  ])('%s meets WCAG AA (≥ 4.5:1)', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA);
  });
});
