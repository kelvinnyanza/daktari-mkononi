import { z } from 'zod';
import { paginationSchema } from './common.js';

/**
 * Health tips (UI Phase 3): public health-education content, Swahili + English.
 * Never PHI. Lifecycle DRAFT → REVIEWED → PUBLISHED → ARCHIVED.
 */

export const healthTipCategorySchema = z.enum([
  'NUTRITION',
  'EXERCISE',
  'WATER_HYGIENE',
  'MENTAL_HEALTH',
  'CHRONIC_DISEASE',
  'MATERNAL_CHILD',
  'MALARIA',
  'PREVENTION',
]);
export type HealthTipCategory = z.infer<typeof healthTipCategorySchema>;

export const healthTipStatusSchema = z.enum(['DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED']);
export type HealthTipStatus = z.infer<typeof healthTipStatusSchema>;

/**
 * Bundled illustrations (unDraw, recoloured to the brand teal). The apps ship
 * the artwork; a tip names one. Keep in sync with the asset folders
 * (apps/mobile/assets/illustrations, apps/web/public/illustrations).
 */
export const HEALTH_TIP_ILLUSTRATIONS = [
  'eating-together',
  'garden-harvest',
  'sunny-walk',
  'bike-ride',
  'drinking-water',
  'meditation',
  'relaxing-outdoors',
  'doctor-notes',
  'heart-check',
  'parent-and-baby',
  'safe-home',
  'protection',
] as const;
export const healthTipIllustrationSchema = z.enum(HEALTH_TIP_ILLUSTRATIONS);
export type HealthTipIllustration = z.infer<typeof healthTipIllustrationSchema>;

/** Default artwork per category (used when a tip names none in the editor). */
export const CATEGORY_ILLUSTRATION: Readonly<Record<HealthTipCategory, HealthTipIllustration>> = {
  NUTRITION: 'eating-together',
  EXERCISE: 'sunny-walk',
  WATER_HYGIENE: 'drinking-water',
  MENTAL_HEALTH: 'meditation',
  CHRONIC_DISEASE: 'doctor-notes',
  MATERNAL_CHILD: 'parent-and-baby',
  MALARIA: 'safe-home',
  PREVENTION: 'protection',
};

export const tipSourceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  url: z
    .string()
    .trim()
    .url()
    .refine((value) => value.startsWith('https://'), 'source links must be https'),
});
export type TipSource = z.infer<typeof tipSourceSchema>;

const takeawaysSchema = z.array(z.string().trim().min(3).max(200)).min(1).max(6);
const optionalDate = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .nullable();

const contentShape = {
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug: lowercase words joined by hyphens'),
  category: healthTipCategorySchema,
  titleSw: z.string().trim().min(3).max(120),
  titleEn: z.string().trim().min(3).max(120),
  summarySw: z.string().trim().min(10).max(220),
  summaryEn: z.string().trim().min(10).max(220),
  bodySw: z.string().trim().min(40).max(8000),
  bodyEn: z.string().trim().min(40).max(8000),
  takeawaysSw: takeawaysSchema,
  takeawaysEn: takeawaysSchema,
  illustration: healthTipIllustrationSchema,
  sources: z.array(tipSourceSchema).min(1).max(6),
  priority: z.number().int().min(0).max(100).default(0),
  publishAt: optionalDate.default(null),
  unpublishAt: optionalDate.default(null),
};

function windowOk(value: { publishAt?: Date | null | undefined; unpublishAt?: Date | null | undefined }): boolean {
  return (
    value.publishAt === null ||
    value.publishAt === undefined ||
    value.unpublishAt === null ||
    value.unpublishAt === undefined ||
    value.unpublishAt.getTime() > value.publishAt.getTime()
  );
}
const WINDOW_MESSAGE = { message: 'unpublishAt must be after publishAt', path: ['unpublishAt'] };

/** POST /api/v1/admin/health-tips — always created as DRAFT. */
export const createHealthTipSchema = z.object(contentShape).strict().refine(windowOk, WINDOW_MESSAGE);
export type CreateHealthTipInput = z.infer<typeof createHealthTipSchema>;

/** PATCH /api/v1/admin/health-tips/:id — any subset; status changes go through the action routes. */
export const updateHealthTipSchema = z
  .object({
    ...contentShape,
    priority: z.number().int().min(0).max(100),
    publishAt: optionalDate,
    unpublishAt: optionalDate,
  })
  .partial()
  .strict()
  .refine(windowOk, WINDOW_MESSAGE);
export type UpdateHealthTipInput = z.infer<typeof updateHealthTipSchema>;

/** Fields whose change sends a REVIEWED/PUBLISHED tip back to DRAFT (re-review). */
export const HEALTH_TIP_CONTENT_FIELDS = [
  'category',
  'titleSw',
  'titleEn',
  'summarySw',
  'summaryEn',
  'bodySw',
  'bodyEn',
  'takeawaysSw',
  'takeawaysEn',
  'sources',
] as const;

/** GET /api/v1/health-tips */
export const listPublicTipsQuerySchema = paginationSchema.extend({
  category: healthTipCategorySchema.optional(),
  q: z.string().trim().min(2).max(80).optional(),
  /** Dev builds only (ignored in production): include DRAFT/REVIEWED tips, marked RASIMU. */
  preview: z.literal('drafts').optional(),
});
export type ListPublicTipsQuery = z.infer<typeof listPublicTipsQuerySchema>;

/** GET /api/v1/admin/health-tips */
export const listAdminTipsQuerySchema = paginationSchema.extend({
  status: healthTipStatusSchema.optional(),
  category: healthTipCategorySchema.optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
export type ListAdminTipsQuery = z.infer<typeof listAdminTipsQuerySchema>;

/** Tip as the patient app receives it (both languages, so a language switch works offline). */
export interface PublicHealthTip {
  id: string;
  slug: string;
  category: HealthTipCategory;
  status: HealthTipStatus; // PUBLISHED, or DRAFT/REVIEWED in dev preview
  title: { sw: string; en: string };
  summary: { sw: string; en: string };
  body: { sw: string; en: string };
  takeaways: { sw: string[]; en: string[] };
  illustration: string;
  /** Stable API path (versioned) when an image was uploaded, else null. */
  imageUrl: string | null;
  sources: TipSource[];
  reviewedBy: string | null; // doctor's display name
  reviewedAt: string | null;
  publishedAt: string | null;
  priority: number;
}

// ── Body format ──────────────────────────────────────────────────────────────

export type TipBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] };

/**
 * The article format is deliberately tiny so editors cannot break the app:
 * "## " starts a heading, "- " (or "* ") a bullet, and blank lines separate
 * paragraphs. Everything else is plain text — no HTML, no links, no images.
 */
export function parseTipBody(text: string): TipBlock[] {
  const blocks: TipBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushBullets = (): void => {
    if (bullets.length > 0) blocks.push({ type: 'bullets', items: bullets });
    bullets = [];
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushBullets();
    } else if (line.startsWith('## ')) {
      flushParagraph();
      flushBullets();
      blocks.push({ type: 'heading', text: line.slice(3).trim() });
    } else if (/^[-*] /.test(line)) {
      flushParagraph();
      bullets.push(line.slice(2).trim());
    } else {
      flushBullets();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushBullets();
  return blocks;
}
