/**
 * The 110 DRAFT health tips (packages/db/prisma/seed-data/health-tips): every
 * one must pass the API's own schema and the content house rules.
 */
import { describe, expect, it } from 'vitest';
import { createHealthTipSchema, healthTipCategorySchema, parseTipBody } from '@daktari/schemas';
import { HEALTH_TIP_DRAFTS } from '../../../packages/db/prisma/seed-data/health-tips/index.js';

const ALL_TEXT = (tip: (typeof HEALTH_TIP_DRAFTS)[number]): string =>
  [tip.titleSw, tip.titleEn, tip.summarySw, tip.summaryEn, tip.bodySw, tip.bodyEn, ...tip.takeawaysSw, ...tip.takeawaysEn].join('\n');

describe('health tip drafts', () => {
  it('there are 110, with unique slugs, covering every category', () => {
    expect(HEALTH_TIP_DRAFTS).toHaveLength(110);
    expect(new Set(HEALTH_TIP_DRAFTS.map((tip) => tip.slug)).size).toBe(110);
    const categories = new Set(HEALTH_TIP_DRAFTS.map((tip) => tip.category));
    expect([...categories].sort()).toEqual([...healthTipCategorySchema.options].sort());
    for (const category of healthTipCategorySchema.options) {
      expect(HEALTH_TIP_DRAFTS.filter((tip) => tip.category === category).length).toBeGreaterThanOrEqual(10);
    }
  });

  it.each(HEALTH_TIP_DRAFTS.map((tip) => [tip.slug, tip] as const))('%s passes the API schema', (_slug, tip) => {
    const parsed = createHealthTipSchema.safeParse(tip);
    expect(parsed.success ? 'ok' : JSON.stringify(parsed.error.issues)).toBe('ok');
  });

  it('every tip says when to see a health worker, in both languages', () => {
    for (const tip of HEALTH_TIP_DRAFTS) {
      expect(parseTipBody(tip.bodySw).some((b) => b.type === 'heading' && b.text.startsWith('Muone mhudumu wa afya'))).toBe(true);
      expect(parseTipBody(tip.bodyEn).some((b) => b.type === 'heading' && b.text === 'When to see a health worker')).toBe(true);
    }
  });

  it('no medicine doses, only 112/115 as emergency numbers, no miracle claims', () => {
    for (const tip of HEALTH_TIP_DRAFTS) {
      const text = ALL_TEXT(tip);
      // A number followed by a dose unit = a dose. (Clinic/packet directions are referenced, never given.)
      expect(text, tip.slug).not.toMatch(/\d+\s?(mg|mcg|ml|g\b|iu\b|vidonge|tablets?|capsules?|kijiko|vijiko|teaspoons?)/i);
      expect(text, tip.slug).not.toMatch(/\b(999|911|114)\b/);
      // Claims, not warnings: "there is no miracle cure" is fine, "cures everything" is not.
      // Quoted phrases are the claims a tip warns against, so they are skipped.
      const claims = text.replace(/"[^"]*"/g, '').replace(/(no|hakuna) (miracle cure|dawa ya miujiza)/gi, '');
      expect(claims, tip.slug).not.toMatch(/\b(cures? (all|everything)|guaranteed?|100%|inatibu kila)\b/i);
      expect(claims, tip.slug).not.toMatch(/miracle cure|dawa ya miujiza/i);
      // Any number someone is told to call must be 112 or 115.
      for (const match of text.matchAll(/\b(?:piga|call|au|or)\s+(\d{3,4})\b/gi)) {
        expect(['112', '115'], tip.slug).toContain(match[1]);
      }
    }
  });

  it('every source is an https link to WHO or the Tanzania Ministry of Health', () => {
    for (const tip of HEALTH_TIP_DRAFTS) {
      for (const source of tip.sources) {
        expect(source.url, tip.slug).toMatch(/^https:\/\/www\.(who\.int|moh\.go\.tz)/);
      }
    }
  });
});
