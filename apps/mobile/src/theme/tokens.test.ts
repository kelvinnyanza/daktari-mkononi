import { contrastRatio } from './tokens';

describe('contrastRatio', () => {
  it('is 21:1 for black on white, in either order', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for identical colours', () => {
    expect(contrastRatio('#0F7366', '#0F7366')).toBeCloseTo(1, 5);
  });

  it('matches the published brand teal ratio (5.7:1 on white)', () => {
    expect(contrastRatio('#0F7366', '#FFFFFF')).toBeCloseTo(5.73, 1);
  });
});
