/**
 * Zod-driven form validation — the SAME schemas the server validates with
 * (@daktari/schemas), so client and server can never disagree on rules.
 */
import type { z } from 'zod';

export type FieldErrors = Record<string, string>;

export function validateForm<Schema extends z.ZodTypeAny>(
  schema: Schema,
  values: unknown,
):
  | { ok: true; data: z.infer<Schema> }
  | { ok: false; fieldErrors: FieldErrors } {
  const parsed = schema.safeParse(values);
  if (parsed.success) {
    return { ok: true, data: parsed.data as z.infer<Schema> };
  }
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]?.toString() ?? '_';
    // First issue per field wins; schema messages are the source of truth
    // (Swahili where the schema defines it, e.g. the phone format message).
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}
