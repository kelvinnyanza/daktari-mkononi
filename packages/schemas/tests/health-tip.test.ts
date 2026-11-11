import { describe, expect, it } from 'vitest';
import {
  createHealthTipSchema,
  listPublicTipsQuerySchema,
  parseTipBody,
  updateHealthTipSchema,
} from '../src/index.js';

const valid = {
  slug: 'kunywa-maji-safi',
  category: 'WATER_HYGIENE',
  titleSw: 'Kunywa maji safi',
  titleEn: 'Drink safe water',
  summarySw: 'Chemsha au tibu maji kabla ya kunywa.',
  summaryEn: 'Boil or treat water before you drink it.',
  bodySw: '## Kwa nini\nMaji machafu husababisha kuhara.\n\n- Chemsha maji\n- Hifadhi kwenye chombo safi',
  bodyEn: '## Why\nUnsafe water causes diarrhoea.\n\n- Boil water\n- Store it in a clean container',
  takeawaysSw: ['Chemsha maji ya kunywa'],
  takeawaysEn: ['Boil drinking water'],
  illustration: 'drinking-water',
  sources: [{ name: 'WHO — Drinking-water', url: 'https://www.who.int/news-room/fact-sheets/detail/drinking-water' }],
};

describe('health tip content', () => {
  it('accepts a complete bilingual tip and defaults priority / dates', () => {
    const parsed = createHealthTipSchema.parse(valid);
    expect(parsed.priority).toBe(0);
    expect(parsed.publishAt).toBeNull();
  });

  it('requires https sources, a known illustration and a kebab-case slug', () => {
    expect(createHealthTipSchema.safeParse({ ...valid, sources: [{ name: 'X', url: 'http://who.int' }] }).success).toBe(false);
    expect(createHealthTipSchema.safeParse({ ...valid, illustration: 'random' }).success).toBe(false);
    expect(createHealthTipSchema.safeParse({ ...valid, slug: 'Kunywa Maji' }).success).toBe(false);
  });

  it('rejects status (actions only) and an unpublish date before the publish date', () => {
    expect(updateHealthTipSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(false);
    expect(
      updateHealthTipSchema.safeParse({
        publishAt: '2026-12-01T00:00:00.000Z',
        unpublishAt: '2026-11-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('public list query: category filter and dev preview flag', () => {
    expect(listPublicTipsQuerySchema.parse({ category: 'MALARIA', preview: 'drafts' })).toMatchObject({
      category: 'MALARIA',
      preview: 'drafts',
      page: 1,
    });
    expect(listPublicTipsQuerySchema.safeParse({ preview: 'all' }).success).toBe(false);
  });
});

describe('parseTipBody', () => {
  it('reads headings, paragraphs and bullet lists', () => {
    expect(parseTipBody('## Kwa nini\nMstari mmoja\nunaoendelea.\n\n- moja\n* mbili\n\nMwisho')).toEqual([
      { type: 'heading', text: 'Kwa nini' },
      { type: 'paragraph', text: 'Mstari mmoja unaoendelea.' },
      { type: 'bullets', items: ['moja', 'mbili'] },
      { type: 'paragraph', text: 'Mwisho' },
    ]);
  });

  it('treats markup it does not know as plain text', () => {
    expect(parseTipBody('<b>hi</b> [link](x)')).toEqual([{ type: 'paragraph', text: '<b>hi</b> [link](x)' }]);
  });
});
