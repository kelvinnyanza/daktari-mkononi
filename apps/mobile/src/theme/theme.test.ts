import { AVATAR_TINTS, initials } from '../ui/Avatar';
import { lightColors as c } from './theme';
import { contrastRatio } from './tokens';

const AA_TEXT = 4.5; // WCAG 1.4.3 body text
const AA_UI = 3; // WCAG 1.4.11 non-text (input borders, focus ring)

describe('design system colour roles (light)', () => {
  it.each([
    ['text on background', c.text, c.background],
    ['text on surface', c.text, c.surface],
    ['text on muted surface', c.text, c.surfaceMuted],
    ['secondary text on background', c.textSecondary, c.background],
    ['secondary text on surface', c.textSecondary, c.surface],
    ['secondary text on muted surface', c.textSecondary, c.surfaceMuted],
    ['primary (link/ghost) on surface', c.primary, c.surface],
    ['primary (link/ghost) on background', c.primary, c.background],
    ['label on primary button', c.textOnPrimary, c.primary],
    ['label on pressed primary', c.textOnPrimary, c.primaryPressed],
    ['label on secondary button', c.onPrimarySoft, c.primarySoft],
    ['label on pressed secondary', c.onPrimarySoft, c.primarySoftPressed],
    ['label on danger button', c.textOnPrimary, c.dangerFg],
    ['label on pressed danger', c.textOnPrimary, c.dangerPressed],
    ['success on its tint', c.successFg, c.successBg],
    ['warning on its tint', c.warningFg, c.warningBg],
    ['danger on its tint', c.dangerFg, c.dangerBg],
    ['info on its tint', c.infoFg, c.infoBg],
    ['neutral on its tint', c.neutralFg, c.neutralBg],
    ['danger text on surface', c.dangerFg, c.surface],
    ['emergency text on emergency', c.onEmergency, c.emergencyBg],
    ['emergency text on pressed emergency', c.onEmergency, c.emergencyPressed],
    ['emergency label on white call button', c.emergencyBg, c.onEmergency],
  ])('%s meets AA text contrast', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each([
    ['input border on surface', c.borderStrong, c.surface],
    ['focus ring on background', c.focus, c.background],
    // The ring is the control's OUTER edge, so it is judged against the page around it.
    ['focus ring on surface', c.focus, c.surface],
    ['focus ring on muted surface', c.focus, c.surfaceMuted],
  ])('%s meets non-text contrast (3:1)', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_UI);
  });

  it('emergency stays a strong red, distinct from soft tints', () => {
    expect(c.emergencyBg).toBe('#B91C1C');
    expect(contrastRatio(c.emergencyBg, c.background)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(AVATAR_TINTS.map((tint) => [tint.fg, tint.bg]))('avatar initials %s on %s meet AA', (fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe('avatar initials', () => {
  it.each([
    ['Dkt. Amina Mushi', 'AM'],
    ['Dr. Baraka Mwakyusa', 'BM'],
    ['Juma Salim Hamad', 'JH'],
    ['rehema', 'R'],
    ['  ', '?'],
  ])('%s → %s', (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
