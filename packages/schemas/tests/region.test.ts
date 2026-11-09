import { describe, expect, it } from 'vitest';
import { regionFromAny, tzRegionSchema } from '../src/index.js';

describe('regionFromAny', () => {
  it.each([
    ['MWANZA', 'MWANZA'],
    ['Mwanza', 'MWANZA'],
    ['  mwanza ', 'MWANZA'],
    ['Dar es Salaam', 'DAR_ES_SALAAM'],
    ['DAR_ES_SALAAM', 'DAR_ES_SALAAM'],
    ['dar-es-salaam', 'DAR_ES_SALAAM'],
    ['Kaskazini Pemba', 'KASKAZINI_PEMBA'],
  ])('%s → %s', (input, code) => {
    expect(regionFromAny(input)).toBe(code);
  });

  it.each([['UNKNOWN'], [''], ['Nairobi'], [null], [undefined]])('%s → null', (input) => {
    expect(regionFromAny(input)).toBeNull();
  });

  it('round-trips every code', () => {
    for (const code of tzRegionSchema.options) expect(regionFromAny(code)).toBe(code);
  });
});
