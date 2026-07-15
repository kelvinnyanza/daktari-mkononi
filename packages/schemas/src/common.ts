import { z } from 'zod';

/**
 * Tanzanian phone number: `+255` followed by 9 digits.
 * Accepts and normalizes common local input forms:
 *   `0712345678`   -> `+255712345678`
 *   `255712345678` -> `+255712345678`
 *   `+255 712 345 678` / `0712-345-678` (spaces and dashes stripped)
 */
export const tzPhoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s-]/g, ''))
  .transform((value) => {
    if (/^0\d{9}$/.test(value)) return `+255${value.slice(1)}`;
    if (/^255\d{9}$/.test(value)) return `+${value}`;
    return value;
  })
  .pipe(
    z
      .string()
      .regex(/^\+255\d{9}$/, 'Namba ya simu si sahihi — tumia +255 ikifuatiwa na tarakimu 9'),
  );
export type TzPhone = z.infer<typeof tzPhoneSchema>;

/** CUID (Prisma default) — also accepts cuid2. */
export const cuidSchema = z
  .string()
  .regex(/^c[a-z0-9]{7,31}$/, 'must be a valid CUID');

/** UUID v1–v5. */
export const uuidSchema = z.string().uuid();

/** Entity id: CUID (our Prisma default) or UUID (external systems). */
export const idSchema = z.union([cuidSchema, uuidSchema], {
  errorMap: () => ({ message: 'must be a valid CUID or UUID' }),
});
export type EntityId = z.infer<typeof idSchema>;

/** Platform languages — Swahili first, always the default. */
export const languageSchema = z.enum(['sw', 'en']).default('sw');
export type Language = z.infer<typeof languageSchema>;

/** Money in Tanzanian Shillings: whole-number TZS, no cents. */
export const tzsAmountSchema = z
  .number()
  .int('TZS amounts are whole numbers')
  .positive('amount must be positive');
export type TzsAmount = z.infer<typeof tzsAmountSchema>;

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** ISO date-only string (e.g. 2026-07-15) parsed to a Date. */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')
  .transform((value) => new Date(`${value}T00:00:00.000Z`))
  .refine((date) => !Number.isNaN(date.getTime()), 'invalid calendar date');
