import { translate } from '../i18n';
import { regionLabel, specialtyLabel } from './labels';

const t = (key: Parameters<typeof translate>[0], params?: Record<string, string | number>): string =>
  translate(key, params, 'sw');

describe('display labels', () => {
  it('translates known specialties and title-cases unknown codes', () => {
    expect(specialtyLabel(t, 'PEDIATRICS')).toBe('Magonjwa ya watoto');
    expect(specialtyLabel(t, 'SPORTS_MEDICINE')).toBe('Sports Medicine');
  });
  it.each([
    ['DAR_ES_SALAAM', 'Dar es Salaam'],
    ['KASKAZINI_PEMBA', 'Kaskazini Pemba'],
    ['MWANZA', 'Mwanza'],
  ])('region %s → %s', (code, label) => {
    expect(regionLabel(code)).toBe(label);
  });
});
